import { signWebhook, type WebhookEnvelope } from '@switch-gear/shared/webhooks';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/v1/webhooks/[partner]/route';
import { createDb, type Db } from './db';
import { recordEvent } from './events';
import { resetDemo } from './seed/seed';
import { clearWebhookHandlers, registerWebhookHandler } from './webhooks';

// Needs a migrated Postgres (DATABASE_URL). Resets the database to the demo seed state.
describe.skipIf(!process.env.DATABASE_URL)('partner webhooks (database)', () => {
  let db: Db;
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-webhooks-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };
  const SECRET = 'test_paymock_secret'; // .env.example / route fallback

  const envelope = (eventId: string, type = 'payment.captured'): WebhookEnvelope => ({
    eventId,
    type,
    occurredAt: '2026-11-07T10:00:00.000Z',
    data: { orderNumber: 'ORD-1001', amountPaise: 67800 },
  });

  function send(
    body: unknown,
    {
      partner = 'paymock',
      secret = SECRET,
      signature,
    }: { partner?: string; secret?: string; signature?: string | null } = {},
  ) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const sig = signature === undefined ? signWebhook(secret, raw) : signature;
    if (sig !== null) headers['X-SG-Signature'] = sig;
    return POST(
      new Request(`http://localhost/api/v1/webhooks/${partner}`, {
        method: 'POST',
        headers,
        body: raw,
      }),
      {
        params: Promise.resolve({ partner }),
      },
    );
  }

  // A handler that changes state and writes its event, as real partner handlers will.
  const handler = vi.fn(async (tx: Parameters<typeof recordEvent>[0], e: WebhookEnvelope) => {
    await recordEvent(tx, {
      type: 'payment.failed',
      entityType: 'order',
      entityId: String(e.data.orderNumber),
      payload: {
        orderNumber: String(e.data.orderNumber),
        gatewayRef: e.eventId,
        amountPaise: 67800,
        reason: 'test',
      },
    });
  });

  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    handler.mockClear();
    registerWebhookHandler('paymock', 'payment.captured', handler);
  });
  afterEach(() => clearWebhookHandlers());
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('rejects unsigned and wrongly signed calls without touching the database', async () => {
    const body = envelope('evt_1');
    expect((await send(body, { signature: null })).status).toBe(401);
    expect((await send(body, { signature: 'sha256=00' })).status).toBe(401);
    expect((await send(body, { secret: 'test_printhub_secret' })).status).toBe(401);
    // Signed with paymock's secret but sent as printhub: each partner has its own secret.
    expect((await send(body, { partner: 'printhub' })).status).toBe(401);
    expect(await db.webhookReceipt.count()).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('404s an unknown partner and 422s a bad envelope', async () => {
    expect((await send(envelope('evt_1'), { partner: 'razorpay' })).status).toBe(404);
    expect((await send('{nope')).status).toBe(422);
    expect((await send({ eventId: '', type: 'x', occurredAt: 'yesterday', data: {} })).status).toBe(
      422,
    );
  });

  it('processes a signed webhook once and ignores duplicate eventIds', async () => {
    const first = await send(envelope('evt_1'));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ eventId: 'evt_1', status: 'processed' });

    const again = await send(envelope('evt_1'));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ eventId: 'evt_1', status: 'duplicate' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await db.event.count({ where: { type: 'payment.failed' } })).toBe(1);
    expect(await db.webhookReceipt.findMany()).toMatchObject([
      { partner: 'paymock', eventId: 'evt_1', type: 'payment.captured', outcome: 'processed' },
    ]);
  });

  it('treats the same eventId from different partners as different webhooks', async () => {
    await send(envelope('evt_1'));
    const res = await send(envelope('evt_1', 'printjob.packed'), {
      partner: 'printhub',
      secret: 'test_printhub_secret',
    });
    expect(await res.json()).toEqual({ eventId: 'evt_1', status: 'ignored' });
    expect(await db.webhookReceipt.count()).toBe(2);
  });

  it('handles two copies arriving at once exactly once', async () => {
    const results = await Promise.all([send(envelope('evt_2')), send(envelope('evt_2'))]);
    const statuses = (await Promise.all(results.map((r) => r.json()))).map(
      (b) => (b as { status: string }).status,
    );
    expect(statuses.sort()).toEqual(['duplicate', 'processed']);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('acknowledges types with no handler as ignored', async () => {
    const res = await send(envelope('evt_3', 'payment.refund_settled'));
    expect(await res.json()).toEqual({ eventId: 'evt_3', status: 'ignored' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rolls back when the handler fails, so the retry is processed', async () => {
    handler.mockRejectedValueOnce(new Error('boom'));
    await expect(send(envelope('evt_4'))).rejects.toThrow('boom');
    expect(await db.webhookReceipt.count()).toBe(0);
    expect(await db.event.count()).toBe(0);

    const retry = await send(envelope('evt_4'));
    expect(await retry.json()).toEqual({ eventId: 'evt_4', status: 'processed' });
  });
});
