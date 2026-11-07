import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSim, type SimApp } from '../../../sim/src/app';
import type { SimClock } from '../../../sim/src/clock';
import { POST as webhookPost } from '../app/api/v1/webhooks/[partner]/route';
import { placeOrder } from './checkout';
import { createDb, type Db } from './db';
import { openPayment, registerPaymockHandlers } from './paymock';
import { resetDemo } from './seed/seed';
import { checkoutInput } from './validation/checkout';
import { clearWebhookHandlers } from './webhooks';

// Store and sim together, with no network: the store's calls to PayMock go to the real sim app
// (fastify inject) and PayMock's webhooks go to the real store webhook route and database.
// The sim clock runs at demo speed (1 business day = 10 real minutes, 144×) while the store
// still reads speed 1, as it does until T-15 adds /sim/clock.
describe.skipIf(!process.env.DATABASE_URL)('PayMock end to end at demo speed (database)', () => {
  let db: Db;
  let sim: SimApp;
  const SPEED = 144;
  const PLACED_AT = new Date('2026-11-07T10:00:00.000Z');
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-paymock-sim-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };

  // Sim clocks under test control: business time and an offset on real time.
  let businessMs = PLACED_AT.getTime();
  let realOffsetMs = 0;
  const clock: SimClock = { now: () => new Date(businessMs), speed: () => SPEED };

  /** Store → sim: PayMock's create-payment API, served by the sim app. */
  const toSim = (async (url: URL, init: RequestInit) => {
    const res = await sim.app.inject({
      method: 'POST',
      url: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
      payload: String(init.body),
    });
    return new Response(res.body, { status: res.statusCode });
  }) as unknown as typeof globalThis.fetch;

  /** Sim → store: PayMock's webhooks, handled by the store route. */
  const toStore = (async (_url: URL, init: RequestInit) =>
    webhookPost(
      new Request('http://store.test/api/v1/webhooks/paymock', {
        method: 'POST',
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      }),
      { params: Promise.resolve({ partner: 'paymock' }) },
    )) as unknown as typeof globalThis.fetch;

  async function placeAndOpen(): Promise<{ number: string; gatewayRef: string }> {
    const { orderNumber } = await placeOrder(
      db,
      checkoutInput.parse({
        items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 }],
        customer: {
          name: 'Demo Speed',
          email: 'demo.speed@example.com',
          phone: '9876543210',
          address: '1 Test Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560034',
        },
      }),
      new Date(businessMs),
    );
    const payment = await openPayment(db, orderNumber, {
      simUrl: 'http://sim.test',
      returnUrl: 'http://store.test/orders/x',
      fetch: toSim,
    });
    return { number: orderNumber, gatewayRef: payment!.gatewayRef };
  }

  const click = (gatewayRef: string, outcome: string) =>
    sim.app.inject({
      method: 'POST',
      url: `/paymock/pay/${gatewayRef}/${outcome}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
  const statusOf = async (number: string) =>
    (await db.order.findUniqueOrThrow({ where: { number } })).status;

  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    registerPaymockHandlers();
    businessMs = PLACED_AT.getTime();
    realOffsetMs = 0;
    sim = buildSim({
      clock,
      realNow: () => Date.now() + realOffsetMs,
      storeUrl: 'http://store.test',
      fetch: toStore,
      schedule: () => {},
      settleEveryMs: 0,
    });
  });
  afterEach(async () => {
    clearWebhookHandlers();
    await sim.app.close();
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('takes a payment after a business day but under 5 real minutes', async () => {
    const { number, gatewayRef } = await placeAndOpen();
    // 14 real seconds at 144× is over half a business hour; push it to a whole business day.
    realOffsetMs = 14_000;
    businessMs += 24 * 60 * 60_000;

    const res = await click(gatewayRef, 'success');
    expect(res.statusCode).toBe(303);
    expect(sim.paymock.get(gatewayRef)?.status).toBe('captured');
    expect(await statusOf(number)).toBe('paid');
  });

  it('expires the payment and cancels the order once both limits have passed', async () => {
    const { number, gatewayRef } = await placeAndOpen();
    realOffsetMs = 5 * 60_000 + 1_000;
    businessMs += 31 * 60_000;

    await click(gatewayRef, 'success');
    expect(sim.paymock.get(gatewayRef)?.status).toBe('failed');
    expect(await statusOf(number)).toBe('cancelled');
    const [event] = await db.event.findMany({ where: { type: 'payment.failed' } });
    expect(event?.payload).toMatchObject({ orderNumber: number, reason: 'expired' });
  });
});
