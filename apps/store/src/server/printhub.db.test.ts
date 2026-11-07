import { signWebhook, SIGNATURE_HEADER } from '@switch-gear/shared/webhooks';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSim, type SimApp } from '../../../sim/src/app';
import { GET as listRoute, POST as createRoute } from '../app/api/v1/print-jobs/route';
import { POST as reprintRoute } from '../app/api/v1/print-jobs/[id]/reprint/route';
import { parseKeysFile } from './api-keys';
import { POST as webhookPost } from '../app/api/v1/webhooks/[partner]/route';
import { placeOrder } from './checkout';
import { createDb, type Db } from './db';
import { handleCaptured } from './paymock';
import { createPrintJob, markLatePrintJobs, registerPrinthubHandlers } from './printhub';
import { resetDemo } from './seed/seed';
import { checkoutInput } from './validation/checkout';
import { clearWebhookHandlers } from './webhooks';

const DAY = 86_400_000;
describe.skipIf(!process.env.DATABASE_URL)('PrintHub store integration (database)', () => {
  let db: Db;
  let sim: SimApp;
  let now: number;
  let failAfterAccept: boolean;
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-printhub-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };
  const toSim = (async (url: URL, init: RequestInit) => {
    const res = await sim.app.inject({
      method: 'POST',
      url: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
      payload: String(init.body),
    });
    if (failAfterAccept) {
      failAfterAccept = false;
      throw new Error('lost response');
    }
    return new Response(res.body, { status: res.statusCode });
  }) as unknown as typeof fetch;
  const submit = (number: string, reprintId?: string) =>
    createPrintJob(db, number, {
      simUrl: 'http://sim.test',
      fetch: toSim,
      now: new Date(now),
      reprintId,
    });
  const toStore = (async (_url: URL, init: RequestInit) =>
    webhookPost(
      new Request('http://store.test/api/v1/webhooks/printhub', {
        method: 'POST',
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      }),
      { params: Promise.resolve({ partner: 'printhub' }) },
    )) as unknown as typeof fetch;
  async function order(paid = true) {
    const { orderNumber } = await placeOrder(
      db,
      checkoutInput.parse({
        items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 }],
        customer: {
          name: 'Demo Print',
          email: 'demo.print@example.com',
          phone: '9876543210',
          address: '1 Test Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560034',
        },
      }),
      new Date(now),
    );
    const row = await db.order.findUniqueOrThrow({ where: { number: orderNumber } });
    if (paid)
      await db.$transaction((tx) =>
        handleCaptured(tx, {
          gatewayRef: `pay_${row.id}`,
          orderRef: row.id,
          orderNumber,
          amountPaise: row.totalPaise,
          feePaise: 0,
          feeGstPaise: 0,
          capturedAt: new Date(now).toISOString(),
        }),
      );
    return orderNumber;
  }
  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    registerPrinthubHandlers();
    now = Date.parse('2026-11-07T10:00:00Z');
    failAfterAccept = false;
    sim = buildSim(
      { clock: { now: () => new Date(now), speed: () => 144 }, settleEveryMs: 0 },
      { fetch: toStore, random: () => 0.5, tickEveryMs: 0 },
    );
  });
  afterEach(async () => {
    clearWebhookHandlers();
    await sim.app.close();
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('accepts only paid orders, serializes racing creates, and records each production status', async () => {
    await expect(submit(await order(false))).rejects.toMatchObject({ code: 'order_not_printable' });
    const number = await order();
    const results = await Promise.allSettled([submit(number), submit(number)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.printJob.count()).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { number } })).status).toBe('printing');
    now += 2 * DAY;
    await sim.printhub.tick();
    const [job] = await db.printJob.findMany();
    expect(job).toMatchObject({ status: 'handed_over', costPaise: 26000, attempt: 1 });
    expect(
      (
        await db.event.findMany({ where: { type: 'printjob.status' }, orderBy: { seq: 'asc' } })
      ).map((e) => (e.payload as { status: string }).status),
    ).toEqual(['received', 'in_production', 'quality_check', 'packed', 'handed_over']);
    // Shipping owns printing -> shipped (T-14).
    expect((await db.order.findUniqueOrThrow({ where: { number } })).status).toBe('printing');
  });

  it('recovers an accepted request whose response was lost without duplicating partner work', async () => {
    const number = await order();
    failAfterAccept = true;
    await expect(submit(number)).rejects.toMatchObject({ code: 'printhub_unavailable' });
    expect(await db.printJob.count()).toBe(0);
    await sim.printhub.tick(); // callback arrives before the store retries its lost response
    expect((await db.order.findUniqueOrThrow({ where: { number } })).status).toBe('paid');
    const job = await submit(number);
    now += 2 * DAY;
    await sim.printhub.tick();
    expect((await db.printJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'handed_over',
    );
  });

  it('allows one free reprint of the latest misprint and ignores duplicate callbacks', async () => {
    await sim.app.close();
    sim = buildSim(
      { clock: { now: () => new Date(now), speed: () => 144 }, settleEveryMs: 0 },
      { fetch: toStore, random: () => 0.01, tickEveryMs: 0 },
    );
    const number = await order();
    const first = await submit(number);
    await expect(submit(number, first.id)).rejects.toMatchObject({ code: 'not_reprintable' });
    now += DAY;
    await sim.printhub.tick();
    expect((await db.printJob.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      'misprint',
    );
    const attempts = await Promise.allSettled([submit(number, first.id), submit(number, first.id)]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const jobs = await db.printJob.findMany({ orderBy: { attempt: 'asc' } });
    expect(jobs[1]).toMatchObject({ attempt: 2, costPaise: 0, status: 'received' });
    expect(await db.event.count({ where: { type: 'printjob.misprint' } })).toBe(1);
    expect(await db.order.count({ where: { number, status: 'printing' } })).toBe(1);
  });

  it('emits late only above two business days and only once under racing timers', async () => {
    const number = await order();
    const job = await submit(number);
    now += 2 * DAY;
    expect(await markLatePrintJobs(db, new Date(now))).toEqual([]);
    now++;
    await Promise.all([markLatePrintJobs(db, new Date(now)), markLatePrintJobs(db, new Date(now))]);
    const events = await db.event.findMany({ where: { type: 'printjob.late' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      partnerRef: job.partnerRef,
      orderNumber: number,
      status: 'received',
      dueAt: '2026-11-09T10:00:00.000Z',
    });
    now += DAY;
    await sim.printhub.tick();
    expect(await db.event.count({ where: { type: 'printjob.late' } })).toBe(1);
  });
  it('enforces print scopes and validates bodies, filters and reprint IDs at the routes', async () => {
    const keys = parseKeysFile(readFileSync(options.keysPath, 'utf8'));
    const request = (key: string | undefined, body?: unknown) =>
      new Request('http://store.test/api/v1/print-jobs', {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect((await createRoute(request(undefined, {}))).status).toBe(401);
    for (const department of [
      'finance',
      'marketing',
      'support',
      'engineering',
      'hq',
      'founder',
    ] as const) {
      expect((await createRoute(request(keys[department], {}))).status, department).toBe(403);
      expect(
        (
          await reprintRoute(request(keys[department], {}), {
            params: Promise.resolve({ id: 'unknown' }),
          })
        ).status,
        department,
      ).toBe(403);
    }
    for (const department of ['finance', 'marketing', 'support', 'engineering'] as const)
      expect((await listRoute(request(keys[department]))).status, department).toBe(403);
    for (const department of ['fulfilment', 'hq', 'founder'] as const)
      expect((await listRoute(request(keys[department]))).status, department).toBe(200);
    expect((await createRoute(request(keys.fulfilment, {}))).status).toBe(422);
    const invalid = new Request('http://store.test/api/v1/print-jobs?status=made_up', {
      headers: { authorization: `Bearer ${keys.fulfilment}` },
    });
    expect((await listRoute(invalid)).status).toBe(422);
    expect(
      (
        await reprintRoute(request(keys.fulfilment, {}), {
          params: Promise.resolve({ id: 'unknown' }),
        })
      ).status,
    ).toBe(404);
    const number = await order();
    const job = await submit(number);
    const res = await listRoute(request(keys.fulfilment));
    expect(await res.json()).toEqual([
      expect.objectContaining({ id: job.id, orderNumber: number, status: 'received' }),
    ]);
  });

  it('rejects unsigned, mismatched and skipped stages; rolls receipts back and dedupes valid callbacks', async () => {
    const number = await order();
    const job = await submit(number);
    const row = await db.order.findUniqueOrThrow({ where: { number } });
    const callback = async (status: string, eventId = 'test-event', signed = true, attempt = 1) => {
      const raw = JSON.stringify({
        eventId,
        type: 'printjob.status',
        occurredAt: new Date(now).toISOString(),
        data: {
          partnerRef: job.partnerRef,
          orderRef: row.id,
          orderNumber: number,
          attempt,
          status,
          skus: [],
        },
      });
      return webhookPost(
        new Request('http://store.test/api/v1/webhooks/printhub', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(signed ? { [SIGNATURE_HEADER]: signWebhook('test_printhub_secret', raw) } : {}),
          },
          body: raw,
        }),
        { params: Promise.resolve({ partner: 'printhub' }) },
      );
    };
    expect((await callback('in_production', 'unsigned', false)).status).toBe(401);
    expect((await callback('packed')).status).toBe(409);
    expect(await db.webhookReceipt.count()).toBe(0);
    expect((await callback('in_production', 'wrong-attempt', true, 2)).status).toBe(409);
    expect((await callback('in_production')).status).toBe(200);
    expect(await (await callback('in_production')).json()).toMatchObject({ status: 'duplicate' });
    expect((await callback('received', 'stale-received')).status).toBe(200);
    expect((await db.printJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'in_production',
    );
    expect(await db.event.count({ where: { type: 'printjob.status' } })).toBe(2);
  });
});
