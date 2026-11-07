import { PENDING_RESOLVE_WITHIN_MS, SETTLEMENT_AFTER_MS } from '@switch-gear/shared/paymock';
import { signWebhook, verifyWebhook } from '@switch-gear/shared/webhooks';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSim } from './app';
import type { SimClock } from './clock';

const SECRET = 'test_paymock_secret';
const T0 = new Date('2026-11-07T10:00:00.000Z').getTime();

function setup({
  storeStatus = 200,
  speed = 1,
}: { storeStatus?: number | number[]; speed?: number } = {}) {
  let nowMs = T0;
  const clock: SimClock = { now: () => new Date(nowMs), speed: () => speed };
  const sent: { body: Record<string, unknown>; signed: boolean }[] = [];
  const statuses = Array.isArray(storeStatus) ? [...storeStatus] : null;
  const fetch = (async (url: URL, init: RequestInit) => {
    const raw = String(init.body);
    const sig = (init.headers as Record<string, string>)['X-SG-Signature'];
    sent.push({ body: JSON.parse(raw), signed: verifyWebhook(SECRET, raw, sig) });
    expect(String(url)).toBe('http://store.test/api/v1/webhooks/paymock');
    const status = statuses ? (statuses.shift() ?? 200) : (storeStatus as number);
    return new Response('{}', { status });
  }) as unknown as typeof globalThis.fetch;
  const scheduled: { fn: () => void; ms: number }[] = [];
  const sim = buildSim({
    clock,
    storeUrl: 'http://store.test',
    secret: SECRET,
    fetch,
    random: () => 1,
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
    settleEveryMs: 0,
  });
  return {
    ...sim,
    sent,
    scheduled,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

type Sim = ReturnType<typeof setup>;
let current: Sim | undefined;
afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

const createBody = {
  orderRef: 'cm_order_a',
  orderNumber: 'ORD-1001',
  amountPaise: 59900,
  returnUrl: 'http://localhost:3000/orders/ORD-1001?t=abc',
  expiresAt: new Date(T0 + 30 * 60_000).toISOString(),
};

async function create(sim: Sim, body: unknown = createBody, secret = SECRET) {
  const raw = JSON.stringify(body);
  return sim.app.inject({
    method: 'POST',
    url: '/paymock/v1/payments',
    headers: { 'content-type': 'application/json', 'x-sg-signature': signWebhook(secret, raw) },
    payload: raw,
  });
}

async function openPayment(sim: Sim): Promise<string> {
  const res = await create(sim);
  expect(res.statusCode).toBe(200);
  return (res.json() as { gatewayRef: string }).gatewayRef;
}

const click = (sim: Sim, ref: string, outcome: string) =>
  sim.app.inject({
    method: 'POST',
    url: `/paymock/pay/${ref}/${outcome}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: '',
  });

describe('PayMock (sim)', () => {
  it('opens a payment only for a correctly signed request', async () => {
    const sim = (current = setup());
    expect((await create(sim, createBody, 'wrong-secret')).statusCode).toBe(401);
    expect((await create(sim, { ...createBody, amountPaise: -1 })).statusCode).toBe(422);

    const res = await create(sim);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { gatewayRef: string; payPath: string; status: string };
    expect(body).toMatchObject({ status: 'created', payPath: `/paymock/pay/${body.gatewayRef}` });
  });

  it('reuses the open payment when the customer comes back', async () => {
    const sim = (current = setup());
    expect(await openPayment(sim)).toBe(await openPayment(sim));
  });

  it('gives a reused order number (after a demo reset) its own payment', async () => {
    const sim = (current = setup());
    const old = await openPayment(sim);
    await click(sim, old, 'success');

    // demo:reset restarts numbering: a new ORD-1001 with a new internal id and amount.
    const res = await create(sim, { ...createBody, orderRef: 'cm_order_new', amountPaise: 99900 });
    const fresh = res.json() as { gatewayRef: string; status: string };
    expect(fresh.gatewayRef).not.toBe(old);
    expect(fresh.status).toBe('created');
    const page = await sim.app.inject({ method: 'GET', url: `/paymock/pay/${fresh.gatewayRef}` });
    expect(page.body).toContain('₹999');
    expect(page.body).toContain(`/paymock/pay/${fresh.gatewayRef}/success`);

    await click(sim, fresh.gatewayRef, 'success');
    expect(sim.sent.at(-1)?.body).toMatchObject({
      data: { orderRef: 'cm_order_new', orderNumber: 'ORD-1001', amountPaise: 99900 },
    });
  });

  it('shows the pay page with the amount and three choices', async () => {
    const sim = (current = setup());
    const ref = await openPayment(sim);
    const res = await sim.app.inject({ method: 'GET', url: `/paymock/pay/${ref}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ORD-1001');
    expect(res.body).toContain('₹599');
    for (const outcome of ['success', 'failure', 'pending']) {
      expect(res.body).toContain(`/paymock/pay/${ref}/${outcome}`);
    }
    expect(res.body).toContain('No real money');
  });

  it('Success sends a signed payment.captured with the fee, then returns to the store', async () => {
    const sim = (current = setup());
    const ref = await openPayment(sim);
    const res = await click(sim, ref, 'success');
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(createBody.returnUrl);
    expect(sim.sent).toHaveLength(1);
    expect(sim.sent[0]).toMatchObject({
      signed: true,
      body: {
        type: 'payment.captured',
        data: {
          gatewayRef: ref,
          orderRef: 'cm_order_a',
          orderNumber: 'ORD-1001',
          amountPaise: 59900,
          feePaise: 1198,
          feeGstPaise: 216,
          capturedAt: new Date(T0).toISOString(),
        },
      },
    });
    // A second click changes nothing.
    await click(sim, ref, 'failure');
    expect(sim.sent).toHaveLength(1);
    expect(sim.paymock.get(ref)?.status).toBe('captured');
  });

  it('Failure sends payment.failed (declined)', async () => {
    const sim = (current = setup());
    const ref = await openPayment(sim);
    await click(sim, ref, 'failure');
    expect(sim.sent[0]?.body).toMatchObject({
      type: 'payment.failed',
      data: { gatewayRef: ref, reason: 'declined', amountPaise: 59900 },
    });
  });

  it('Pending resolves to captured within 5 business minutes', async () => {
    const sim = (current = setup({ speed: 144 }));
    const ref = await openPayment(sim);
    await click(sim, ref, 'pending');
    expect(sim.paymock.get(ref)?.status).toBe('pending');
    expect(sim.sent).toHaveLength(0);

    // random() = 1 → the latest allowed moment, scaled to real time by the clock speed.
    expect(sim.scheduled).toHaveLength(1);
    expect(sim.scheduled[0]!.ms).toBe(PENDING_RESOLVE_WITHIN_MS / 144);
    sim.advance(PENDING_RESOLVE_WITHIN_MS);
    sim.scheduled[0]!.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(sim.paymock.get(ref)?.status).toBe('captured');
    expect(sim.sent[0]?.body.type).toBe('payment.captured');
  });

  it('fails a payment chosen after the order deadline as expired', async () => {
    const sim = (current = setup());
    const ref = await openPayment(sim);
    sim.advance(31 * 60_000);
    await click(sim, ref, 'success');
    expect(sim.sent[0]?.body).toMatchObject({
      type: 'payment.failed',
      data: { reason: 'expired' },
    });
  });

  it('voids a capture the store refuses', async () => {
    const sim = (current = setup({ storeStatus: 409 }));
    const ref = await openPayment(sim);
    await click(sim, ref, 'success');
    expect(sim.paymock.get(ref)?.status).toBe('voided');
    expect(sim.scheduled).toHaveLength(0); // no retry on 4xx
  });

  it('retries a webhook the store could not take, with the same eventId', async () => {
    const sim = (current = setup({ storeStatus: [500, 200] }));
    const ref = await openPayment(sim);
    await click(sim, ref, 'success');
    expect(sim.sent).toHaveLength(1);
    expect(sim.scheduled).toHaveLength(1);
    sim.scheduled[0]!.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(sim.sent).toHaveLength(2);
    expect(sim.sent[1]!.body.eventId).toBe(sim.sent[0]!.body.eventId);
  });

  it('settles captured payments in one batch at T+2', async () => {
    const sim = (current = setup());
    const a = await openPayment(sim);
    await click(sim, a, 'success');
    const second = await create(sim, {
      ...createBody,
      orderRef: 'cm_order_b',
      orderNumber: 'ORD-1002',
      amountPaise: 79900,
    });
    const b = (second.json() as { gatewayRef: string }).gatewayRef;
    await click(sim, b, 'success');
    sim.sent.length = 0;

    sim.advance(SETTLEMENT_AFTER_MS - 1);
    expect(await sim.paymock.settleDue()).toBeNull();
    sim.advance(1);
    const ref = await sim.paymock.settleDue();
    expect(ref).toMatch(/^stl_/);
    expect(sim.sent).toHaveLength(1);
    expect(sim.sent[0]).toMatchObject({
      signed: true,
      body: {
        type: 'settlement.processed',
        data: {
          settlementRef: ref,
          payments: [
            { gatewayRef: a, amountPaise: 59900, feePaise: 1198, feeGstPaise: 216 },
            { gatewayRef: b, amountPaise: 79900, feePaise: 1598, feeGstPaise: 288 },
          ],
        },
      },
    });
    // Nothing is settled twice.
    sim.advance(SETTLEMENT_AFTER_MS);
    expect(await sim.paymock.settleDue()).toBeNull();
  });
});
