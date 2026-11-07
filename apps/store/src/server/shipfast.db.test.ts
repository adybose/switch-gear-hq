import { signWebhook, SIGNATURE_HEADER } from '@switch-gear/shared/webhooks';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSim, type SimApp } from '../../../sim/src/app';
import { POST as webhookPost } from '../app/api/v1/webhooks/[partner]/route';
import { POST as decisionRoute } from '../app/api/v1/approvals/[id]/decision/route';
import { GET as listRoute, POST as createRoute } from '../app/api/v1/shipments/route';
import { POST as reshipRoute } from '../app/api/v1/shipments/[id]/reship/route';
import { parseKeysFile } from './api-keys';
import { clearApprovalActions } from './approvals';
import { placeOrder } from './checkout';
import { createDb, type Db } from './db';
import { handleCaptured } from './paymock';
import { createPrintJob, registerPrinthubHandlers } from './printhub';
import {
  createShipment,
  reshipShipment,
  registerShipfastActions,
  registerShipfastHandlers,
} from './shipfast';
import { resetDemo } from './seed/seed';
import { trackOrder } from './tracking';
import { checkoutInput } from './validation/checkout';
import { clearWebhookHandlers } from './webhooks';

const DAY = 86_400_000;
describe.skipIf(!process.env.DATABASE_URL)('ShipFast store integration (database)', () => {
  let db: Db;
  let sim: SimApp;
  let now: number;
  let random: number;
  let loseResponse: boolean;
  let shipCalls: number;
  let keys: ReturnType<typeof parseKeysFile>;
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-shipfast-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };
  const toSim = (async (url: URL, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/shipfast/v1/shipments') shipCalls++;
    const res = await sim.app.inject({
      method: 'POST',
      url: path,
      headers: init.headers as Record<string, string>,
      payload: String(init.body),
    });
    if (loseResponse && path === '/shipfast/v1/shipments') {
      loseResponse = false;
      throw new Error('lost booking response');
    }
    return new Response(res.body, { status: res.statusCode });
  }) as unknown as typeof fetch;
  const toStore = (async (url: URL, init: RequestInit) =>
    webhookPost(
      new Request(String(url), {
        method: 'POST',
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      }),
      { params: Promise.resolve({ partner: new URL(url).pathname.split('/').at(-1)! }) },
    )) as unknown as typeof fetch;
  const booking = { simUrl: 'http://sim.test', fetch: toSim };
  async function printable(ready = true) {
    const { orderNumber } = await placeOrder(
      db,
      checkoutInput.parse({
        items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 }],
        customer: {
          name: 'Demo Ship',
          email: 'demo.ship@example.com',
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
    await createPrintJob(db, orderNumber, { ...booking, now: new Date(now) });
    if (ready) {
      now += 2 * DAY;
      await sim.printhub.tick();
    }
    return orderNumber;
  }
  const auth = (key: string | undefined): Record<string, string> =>
    key ? { authorization: `Bearer ${key}` } : {};
  const decision = (id: string, decision: 'approve' | 'reject', key = keys.founder) =>
    decisionRoute(
      new Request(`http://store.test/api/v1/approvals/${id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth(key) },
        body: JSON.stringify({ decision, reason: 'Demo decision' }),
      }),
      { params: Promise.resolve({ id }) },
    );
  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    keys = parseKeysFile(readFileSync(options.keysPath, 'utf8'));
    now = Date.parse('2026-11-07T10:00:00Z');
    random = 0.5;
    loseResponse = false;
    shipCalls = 0;
    registerPrinthubHandlers();
    registerShipfastHandlers();
    registerShipfastActions(booking);
    sim = buildSim(
      { clock: { now: () => new Date(now), speed: () => 144 }, settleEveryMs: 0 },
      { fetch: toStore, random: () => 0.5, tickEveryMs: 0 },
      { fetch: toStore, random: () => random, tickEveryMs: 0 },
    );
  });
  afterEach(async () => {
    clearWebhookHandlers();
    clearApprovalActions();
    await sim?.app.close();
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('requires a PrintHub handover, books once under concurrency and tracks delivery', async () => {
    const number = await printable(false);
    await expect(createShipment(db, number, booking)).rejects.toMatchObject({
      code: 'order_not_shippable',
    });
    now += 2 * DAY;
    await sim.printhub.tick();
    const results = await Promise.allSettled([
      createShipment(db, number, booking),
      createShipment(db, number, booking),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(shipCalls).toBe(1);
    const row = await db.shipment.findFirstOrThrow();
    expect(row).toMatchObject({
      status: 'pickup_scheduled',
      sequence: 1,
      attempts: 0,
      costPaise: 5000,
    });
    expect(await db.order.count({ where: { number, status: 'shipped' } })).toBe(1);
    now += DAY;
    await sim.shipfast.tick();
    expect(await db.order.count({ where: { number, status: 'delivered' } })).toBe(1);
    expect(await db.shipment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'delivered',
      attempts: 1,
      deliveredAt: new Date(now),
    });
    expect(await db.event.count({ where: { type: 'shipment.delivered' } })).toBe(1);
    const tracked = await trackOrder(db, number, 'demo.ship@example.com');
    expect(tracked?.awb).toBe(row.awb);
    expect(tracked?.timeline.map((e) => e.label)).toEqual(
      expect.arrayContaining(['Shipment booked', 'Delivered']),
    );
  });

  it('keeps lost-response bookings retryable without duplicate courier work', async () => {
    const number = await printable();
    loseResponse = true;
    await expect(createShipment(db, number, booking)).rejects.toMatchObject({
      code: 'shipfast_unavailable',
    });
    expect(await db.shipment.count()).toBe(0);
    await sim.shipfast.tick();
    const row = await createShipment(db, number, booking);
    now += DAY;
    await sim.shipfast.tick();
    expect(await db.shipment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'delivered',
    });
    expect(await db.event.count({ where: { type: 'shipment.delivered' } })).toBe(1);
  });

  async function secondReship() {
    random = 0.01;
    const number = await printable();
    const original = await createShipment(db, number, booking);
    await expect(reshipShipment(db, original.id, booking)).rejects.toMatchObject({
      code: 'not_reshippable',
    });
    now += 4 * DAY;
    await sim.shipfast.tick();
    expect(await db.order.count({ where: { number, status: 'returned' } })).toBe(1);
    expect(await db.shipment.findUnique({ where: { id: original.id } })).toMatchObject({
      costPaise: 10000,
      attempts: 3,
      status: 'returned_to_origin',
    });
    const first = await reshipShipment(db, original.id, booking);
    if (first.status === 'pending') throw new Error('first reship unexpectedly gated');
    expect(first).toMatchObject({ sequence: 2, reshipOfId: original.id, costPaise: 5000 });
    now += 4 * DAY;
    await sim.shipfast.tick();
    return { number, first };
  }

  it('allows the first reship and gates the second with one deduped approval and no early booking', async () => {
    const { number, first } = await secondReship();
    const results = await Promise.all([
      reshipShipment(db, first.id, booking),
      reshipShipment(db, first.id, booking),
    ]);
    expect(results[0]).toMatchObject({ approvalId: 'APR-1', status: 'pending' });
    expect(results[1]).toEqual(results[0]);
    const pendingResponse = await reshipRoute(
      new Request('http://store.test/api/v1/shipments/reship', {
        method: 'POST',
        headers: auth(keys.fulfilment),
      }),
      { params: Promise.resolve({ id: first.id }) },
    );
    expect(pendingResponse.status).toBe(202);
    expect(await pendingResponse.json()).toEqual({ approvalId: 'APR-1', status: 'pending' });
    expect(shipCalls).toBe(2);
    expect(await db.shipment.count()).toBe(2);
    expect((await decision('APR-1', 'approve', keys.fulfilment)).status).toBe(403);
    const decided = await Promise.all([decision('APR-1', 'approve'), decision('APR-1', 'approve')]);
    expect(decided.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(shipCalls).toBe(3);
    expect(await db.shipment.count()).toBe(3);
    expect(await db.shipment.findFirst({ where: { sequence: 3 } })).toMatchObject({
      reshipOfId: first.id,
      approvalId: expect.any(String),
      costPaise: 5000,
    });
    expect(await db.order.count({ where: { number, status: 'shipped' } })).toBe(1);
    expect(await db.event.count({ where: { type: 'approval.requested' } })).toBe(1);
    await expect(reshipShipment(db, first.id, booking)).rejects.toMatchObject({
      code: 'not_reshippable',
    });
  });

  it('rejects a repeat reship without booking anything and retries a failed approved booking safely', async () => {
    const { first } = await secondReship();
    await reshipShipment(db, first.id, booking);
    expect((await decision('APR-1', 'reject')).status).toBe(200);
    expect(shipCalls).toBe(2);
    await reshipShipment(db, first.id, booking);
    loseResponse = true;
    expect((await decision('APR-2', 'approve')).status).toBe(503);
    expect(
      (await db.approvalRequest.findUniqueOrThrow({ where: { number: 'APR-2' } })).status,
    ).toBe('pending');
    expect(await db.shipment.count()).toBe(2);
    await sim.shipfast.tick();
    expect((await decision('APR-2', 'approve')).status).toBe(200);
    expect(await db.shipment.count()).toBe(3);
  });

  it('refuses a stale approval if the order is refunded while waiting', async () => {
    const { number, first } = await secondReship();
    await reshipShipment(db, first.id, booking);
    // Emulate the later T-18 refund service while this approval waits.
    await db.order.update({ where: { number }, data: { status: 'refunded' } });
    expect((await decision('APR-1', 'approve')).status).toBe(409);
    expect(shipCalls).toBe(2);
    expect(
      (await db.approvalRequest.findUniqueOrThrow({ where: { number: 'APR-1' } })).status,
    ).toBe('pending');
    expect(await db.order.count({ where: { number, status: 'refunded' } })).toBe(1);
  });

  it('records loss as a failed shipment and allows a replacement without inventing a delivery', async () => {
    random = 0;
    const number = await printable();
    const row = await createShipment(db, number, booking);
    now += DAY;
    await sim.shipfast.tick();
    expect(await db.shipment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'lost',
      costPaise: 5000,
      attempts: 0,
    });
    expect(await db.event.findFirst({ where: { type: 'shipment.failed' } })).toMatchObject({
      payload: expect.objectContaining({ orderNumber: number, reason: 'lost', attempt: 0 }),
    });
    expect(await db.order.count({ where: { number, status: 'shipped' } })).toBe(1);
    const replacement = await reshipShipment(db, row.id, booking);
    expect(replacement).toMatchObject({ sequence: 2 });
  });

  it('validates shipment routes and enforces fulfilment, support and read-only scopes', async () => {
    const request = (dept: keyof typeof keys, body?: unknown) =>
      new Request('http://store.test/api/v1/shipments', {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...auth(keys[dept]), 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect(
      (await createRoute(new Request('http://store.test/api/v1/shipments', { method: 'POST' })))
        .status,
    ).toBe(401);
    for (const dept of [
      'finance',
      'marketing',
      'support',
      'engineering',
      'hq',
      'founder',
    ] as const) {
      expect((await createRoute(request(dept, {}))).status).toBe(403);
      expect(
        (await reshipRoute(request(dept, {}), { params: Promise.resolve({ id: 'unknown' }) }))
          .status,
      ).toBe(403);
    }
    for (const dept of ['fulfilment', 'support', 'hq', 'founder'] as const)
      expect((await listRoute(request(dept))).status).toBe(200);
    expect((await createRoute(request('fulfilment', {}))).status).toBe(422);
    expect(
      (await reshipRoute(request('fulfilment', {}), { params: Promise.resolve({ id: 'unknown' }) }))
        .status,
    ).toBe(404);
    expect(
      (
        await listRoute(
          new Request('http://store.test/api/v1/shipments?status=bad', {
            headers: auth(keys.fulfilment),
          }),
        )
      ).status,
    ).toBe(422);
  });

  it('rejects forged, mismatched and skipped callbacks and dedupes valid effects', async () => {
    const number = await printable();
    const row = await createShipment(db, number, booking);
    const callback = (status: string, eventId = 'ship-event', signed = true, sequence = 1) => {
      const raw = JSON.stringify({
        eventId,
        type: 'shipment.status',
        occurredAt: new Date(now).toISOString(),
        data: {
          awb: row.awb,
          orderRef: row.orderId,
          orderNumber: number,
          sequence,
          status,
          attempts: 0,
          costPaise: 5000,
        },
      });
      return webhookPost(
        new Request('http://store.test/api/v1/webhooks/shipfast', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(signed ? { [SIGNATURE_HEADER]: signWebhook('test_shipfast_secret', raw) } : {}),
          },
          body: raw,
        }),
        { params: Promise.resolve({ partner: 'shipfast' }) },
      );
    };
    expect((await callback('picked_up', 'unsigned', false)).status).toBe(401);
    expect((await callback('delivered')).status).toBe(409);
    expect((await callback('picked_up', 'wrong-sequence', true, 2)).status).toBe(409);
    expect((await callback('picked_up')).status).toBe(200);
    expect(await (await callback('picked_up')).json()).toMatchObject({ status: 'duplicate' });
    expect(await db.event.count({ where: { type: 'shipment.status' } })).toBe(2);
  });
});
