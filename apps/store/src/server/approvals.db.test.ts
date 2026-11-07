import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as decide } from '../app/api/v1/approvals/[id]/decision/route';
import { GET as getOne } from '../app/api/v1/approvals/[id]/route';
import { GET as list } from '../app/api/v1/approvals/route';
import { parseKeysFile } from './api-keys';
import {
  clearApprovalActions,
  type ApprovalExecutor,
  pendingApprovalResponse,
  registerApprovalAction,
  requestApproval,
} from './approvals';
import { createDb, type Db } from './db';
import { recordEvent } from './events';
import { loadLimits, refundGate } from './gates';
import { resetDemo } from './seed/seed';

// Needs a migrated Postgres (DATABASE_URL). Resets the database to the demo seed state.
describe.skipIf(!process.env.DATABASE_URL)('approval gates (database)', () => {
  let db: Db;
  let keys: ReturnType<typeof parseKeysFile>;
  const keysPath = join(mkdtempSync(join(tmpdir(), 'sg-approvals-')), '.env.local.keys');
  const options = {
    keysPath,
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };

  const ACTION = 'test.action';
  // Stands in for a real gated action: changes state and writes its own event.
  const execute = vi.fn<ApprovalExecutor>(async (tx, payload, approval) => {
    await recordEvent(tx, {
      type: 'site.down',
      entityType: 'test',
      entityId: approval.number,
      payload: { url: String((payload as { url: string }).url), since: '', statusCode: null },
    });
  });
  const reject = vi.fn<ApprovalExecutor>(async () => {});

  const auth = (key: string | null) =>
    key ? { authorization: `Bearer ${key}` } : ({} as Record<string, string>);

  const post = (id: string, body: unknown, key: string | null = keys.founder ?? null) =>
    decide(
      new Request(`http://localhost/api/v1/approvals/${id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth(key) },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  const getApproval = (id: string, key: string | null = keys.founder ?? null) =>
    getOne(new Request(`http://localhost/api/v1/approvals/${id}`, { headers: auth(key) }), {
      params: Promise.resolve({ id }),
    });

  const request = (action = ACTION, amountPaise: number | null = 150000) =>
    db.$transaction((tx) =>
      requestApproval(tx, {
        department: 'finance',
        action,
        payload: { url: 'https://example.com' },
        amountPaise,
        reason: 'Refund of ₹1,500 is above the ₹1,000 limit',
      }),
    );

  const events = (type: string) => db.event.findMany({ where: { type }, orderBy: { seq: 'asc' } });

  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    keys = parseKeysFile(readFileSync(keysPath, 'utf8'));
    registerApprovalAction(ACTION, execute, reject);
  });
  afterEach(() => {
    clearApprovalActions();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('reads limits from Setting rows', async () => {
    const refund = (limits: Awaited<ReturnType<typeof loadLimits>>) =>
      refundGate(limits, {
        amountPaise: 150000,
        cancelledBeforePrinting: false,
        recentRefundsToCustomer: 0,
      });
    expect(refund(await db.$transaction(loadLimits)).ok).toBe(false);

    await db.setting.update({
      where: { key: 'approval.refund.maxPaise' },
      data: { value: 200000 },
    });
    expect(refund(await db.$transaction(loadLimits)).ok).toBe(true);
  });

  it('refuses to evaluate gates when a limit is missing', async () => {
    await db.setting.delete({ where: { key: 'approval.payout.maxPaise' } });
    await expect(db.$transaction(loadLimits)).rejects.toThrow(/approval\.payout\.maxPaise/);
  });

  it('stores a request, emits approval.requested and answers 202 pending', async () => {
    const pending = await request();
    expect(pending).toEqual({ approvalId: 'APR-1', status: 'pending' });
    expect((await request()).approvalId).toBe('APR-2');

    const res = pendingApprovalResponse(pending);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ approvalId: 'APR-1', status: 'pending' });

    const [event] = await events('approval.requested');
    expect(event).toMatchObject({
      entityType: 'approval',
      entityId: 'APR-1',
      payload: {
        approvalId: 'APR-1',
        department: 'finance',
        action: ACTION,
        amountPaise: 150000,
        reason: 'Refund of ₹1,500 is above the ₹1,000 limit',
      },
    });

    const one = await getApproval('APR-1');
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({
      id: 'APR-1',
      department: 'finance',
      action: ACTION,
      payload: { url: 'https://example.com' },
      amountPaise: 150000,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
    });
  });

  it('accepts decisions only from the founder key', async () => {
    await request();
    expect((await post('APR-1', { decision: 'approve' }, null)).status).toBe(401);
    for (const dept of ['finance', 'hq', 'marketing', 'support', 'fulfilment', 'engineering']) {
      const res = await post('APR-1', { decision: 'approve' }, keys[dept as keyof typeof keys]!);
      expect(res.status, dept).toBe(403);
    }
    expect(execute).not.toHaveBeenCalled();
    expect(
      (await db.approvalRequest.findUniqueOrThrow({ where: { number: 'APR-1' } })).status,
    ).toBe('pending');
  });

  it('executes an approved action exactly once, even with concurrent decisions', async () => {
    await request();
    const results = await Promise.all([
      post('APR-1', { decision: 'approve' }),
      post('APR-1', { decision: 'approve', reason: 'ok' }),
      post('APR-1', { decision: 'reject', reason: 'no' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);

    const row = await db.approvalRequest.findUniqueOrThrow({ where: { number: 'APR-1' } });
    expect(row.decidedBy).toBe('founder');
    expect(row.decidedAt).toBeInstanceOf(Date);
    const ran = execute.mock.calls.length + reject.mock.calls.length;
    expect(ran).toBe(1);
    expect(await events('approval.decided')).toHaveLength(1);

    const again = await post('APR-1', { decision: 'approve' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'already_decided' });
  });

  it('approve runs the action and emits approval.decided plus the action events', async () => {
    await request();
    const res = await post('APR-1', { decision: 'approve' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'APR-1',
      status: 'approved',
      decidedBy: 'founder',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();

    expect(await events('site.down')).toHaveLength(1);
    const [decided] = await events('approval.decided');
    expect(decided!.payload).toEqual({
      approvalId: 'APR-1',
      action: ACTION,
      decision: 'approved',
      decidedBy: 'founder',
      reason: null,
    });
  });

  it('reject records the reason, does not run the action and emits approval.decided', async () => {
    await request();
    const missing = await post('APR-1', { decision: 'reject' });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({
      error: 'validation_failed',
      details: { reason: 'A reason is required to reject.' },
    });

    const res = await post('APR-1', { decision: 'reject', reason: 'Customer already compensated' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'rejected',
      decisionReason: 'Customer already compensated',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(await events('site.down')).toHaveLength(0);
    const [decided] = await events('approval.decided');
    expect(decided!.payload).toMatchObject({
      decision: 'rejected',
      reason: 'Customer already compensated',
    });
  });

  it('rolls the decision back if the action fails, leaving it pending', async () => {
    await request();
    execute.mockRejectedValueOnce(new Error('partner down'));
    await expect(post('APR-1', { decision: 'approve' })).rejects.toThrow('partner down');
    const row = await db.approvalRequest.findUniqueOrThrow({ where: { number: 'APR-1' } });
    expect(row.status).toBe('pending');
    expect(await events('approval.decided')).toHaveLength(0);

    expect((await post('APR-1', { decision: 'approve' })).status).toBe(200);
  });

  it('will not approve an action the store cannot run, but can reject it', async () => {
    await request('unknown.action');
    const res = await post('APR-1', { decision: 'approve' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'action_not_supported' });
    expect((await post('APR-1', { decision: 'reject', reason: 'not now' })).status).toBe(200);
  });

  it('answers 404 for an unknown approval', async () => {
    expect((await post('APR-99', { decision: 'approve' })).status).toBe(404);
    expect((await getApproval('APR-99')).status).toBe(404);
  });

  it('lists approvals by status for hq and founder only', async () => {
    await request();
    await request();
    await post('APR-1', { decision: 'approve' });

    const get = (query: string, key: string | null) =>
      list(new Request(`http://localhost/api/v1/approvals${query}`, { headers: auth(key) }));

    const pending = await get('?status=pending', keys.hq!);
    expect(pending.status).toBe(200);
    expect(((await pending.json()) as { id: string }[]).map((a) => a.id)).toEqual(['APR-2']);
    const all = (await (await get('', keys.founder!)).json()) as { id: string }[];
    expect(all.map((a) => a.id).sort()).toEqual(['APR-1', 'APR-2']);

    expect((await get('?status=nope', keys.hq!)).status).toBe(422);
    expect((await get('', keys.finance!)).status).toBe(403);
    expect((await getApproval('APR-1', keys.marketing!)).status).toBe(403);
  });
});
