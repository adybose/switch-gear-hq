import { gatewayFee, UNPAID_CANCEL_AFTER_MS } from '@switch-gear/shared/paymock';
import { signWebhook, verifyWebhook } from '@switch-gear/shared/webhooks';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../app/api/v1/webhooks/[partner]/route';
import { placeOrder } from './checkout';
import { createDb, type Db } from './db';
import {
  cancelUnpaidOrders,
  openPayment,
  PaymentUnavailable,
  registerPaymockHandlers,
} from './paymock';
import { resetDemo } from './seed/seed';
import { checkoutInput } from './validation/checkout';
import { clearWebhookHandlers } from './webhooks';

// Needs a migrated Postgres (DATABASE_URL). Resets the database to the demo seed state.
describe.skipIf(!process.env.DATABASE_URL)('PayMock in the store (database)', () => {
  let db: Db;
  const PLACED_AT = new Date('2026-11-07T10:00:00.000Z');
  const SECRET = 'test_paymock_secret';
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-paymock-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };

  async function order(state = 'Karnataka', pincode = '560034') {
    const placed = await placeOrder(
      db,
      checkoutInput.parse({
        items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 2 }],
        customer: {
          name: 'Asha Rao',
          email: 'asha.rao@example.com',
          phone: '9876543210',
          address: '12 Test Layout',
          city: 'Bengaluru',
          state,
          pincode,
        },
      }),
      PLACED_AT,
    );
    return { number: placed.orderNumber, total: placed.pricing.totalPaise };
  }

  let seq = 0;
  async function send(type: string, data: Record<string, unknown>, eventId = `evt_${++seq}`) {
    const raw = JSON.stringify({ eventId, type, occurredAt: '2026-11-07T10:05:00.000Z', data });
    const res = await POST(
      new Request('http://localhost/api/v1/webhooks/paymock', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-SG-Signature': signWebhook(SECRET, raw) },
        body: raw,
      }),
      { params: Promise.resolve({ partner: 'paymock' }) },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  const captured = (number: string, amountPaise: number, gatewayRef = `pay_${number}`) => ({
    gatewayRef,
    orderNumber: number,
    amountPaise,
    ...gatewayFee(amountPaise),
    capturedAt: '2026-11-07T10:05:00.000Z',
  });

  const eventsOf = (type: string) =>
    db.event.findMany({ where: { type }, orderBy: { seq: 'asc' } });
  const statusOf = async (number: string) =>
    (await db.order.findUniqueOrThrow({ where: { number } })).status;

  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    registerPaymockHandlers();
  });
  afterEach(() => clearWebhookHandlers());
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('payment.captured marks the order paid, records the fee and writes order.paid', async () => {
    const { number, total } = await order();
    const res = await send('payment.captured', captured(number, total));
    expect(res).toMatchObject({ status: 200, body: { status: 'processed' } });

    expect(await statusOf(number)).toBe('paid');
    const payment = await db.payment.findUniqueOrThrow({ where: { gatewayRef: `pay_${number}` } });
    expect(payment).toMatchObject({
      status: 'captured',
      amountPaise: total,
      ...gatewayFee(total),
      capturedAt: new Date('2026-11-07T10:05:00.000Z'),
      settledAt: null,
    });
    const [event] = await eventsOf('order.paid');
    expect(event).toMatchObject({
      entityId: number,
      payload: {
        orderNumber: number,
        totalPaise: total,
        itemCount: 2,
        gstType: 'intra',
        paidAt: '2026-11-07T10:05:00.000Z',
      },
    });
  });

  it('uses inter-state GST outside Karnataka', async () => {
    const { number, total } = await order('Maharashtra', '411001');
    await send('payment.captured', captured(number, total));
    const [event] = await eventsOf('order.paid');
    expect(event?.payload).toMatchObject({ gstType: 'inter' });
  });

  it('ignores a repeated webhook', async () => {
    const { number, total } = await order();
    await send('payment.captured', captured(number, total), 'evt_same');
    const again = await send('payment.captured', captured(number, total), 'evt_same');
    expect(again.body.status).toBe('duplicate');
    expect(await eventsOf('order.paid')).toHaveLength(1);
  });

  it('refuses a capture for the wrong amount and changes nothing', async () => {
    const { number, total } = await order();
    const res = await send('payment.captured', captured(number, total - 100));
    expect(res).toMatchObject({ status: 409, body: { error: 'amount_mismatch' } });
    expect(await statusOf(number)).toBe('placed');
    expect(await db.payment.count()).toBe(0);
    expect(await db.webhookReceipt.count()).toBe(0);
  });

  it('refuses a capture for an unknown order or bad data', async () => {
    expect((await send('payment.captured', captured('ORD-9999', 100))).body.error).toBe(
      'unknown_order',
    );
    expect((await send('payment.captured', { gatewayRef: 'x' })).body.error).toBe('invalid_data');
  });

  it('payment.failed cancels the order and writes payment.failed', async () => {
    const { number, total } = await order();
    const res = await send('payment.failed', {
      gatewayRef: 'pay_f',
      orderNumber: number,
      amountPaise: total,
      reason: 'declined',
    });
    expect(res.status).toBe(200);
    expect(await statusOf(number)).toBe('cancelled');
    expect(await db.payment.findUniqueOrThrow({ where: { gatewayRef: 'pay_f' } })).toMatchObject({
      status: 'failed',
      failureReason: 'declined',
    });
    const [event] = await eventsOf('payment.failed');
    expect(event?.payload).toEqual({
      orderNumber: number,
      gatewayRef: 'pay_f',
      amountPaise: total,
      reason: 'declined',
    });
  });

  it('cancels orders unpaid for 30 business minutes, once, with order.cancelled', async () => {
    const { number, total } = await order();
    const deadline = new Date(PLACED_AT.getTime() + UNPAID_CANCEL_AFTER_MS);

    expect(await cancelUnpaidOrders(db, new Date(deadline.getTime() - 1))).toEqual([]);
    expect(await statusOf(number)).toBe('placed');

    expect(await cancelUnpaidOrders(db, deadline)).toEqual([number]);
    expect(await statusOf(number)).toBe('cancelled');
    expect(await cancelUnpaidOrders(db, deadline)).toEqual([]);
    const events = await eventsOf('order.cancelled');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      orderNumber: number,
      totalPaise: total,
      reason: 'unpaid_timeout',
    });
  });

  it('leaves paid orders alone and refuses a capture after the order was cancelled', async () => {
    const paid = await order();
    await send('payment.captured', captured(paid.number, paid.total));
    const late = await order();
    const deadline = new Date(PLACED_AT.getTime() + UNPAID_CANCEL_AFTER_MS);
    expect(await cancelUnpaidOrders(db, deadline)).toEqual([late.number]);
    expect(await statusOf(paid.number)).toBe('paid');

    const res = await send('payment.captured', captured(late.number, late.total));
    expect(res).toMatchObject({ status: 409, body: { error: 'order_not_payable' } });
    expect(await statusOf(late.number)).toBe('cancelled');
  });

  it('settlement.processed settles known captured payments and writes settlement.received', async () => {
    const a = await order();
    const b = await order();
    await send('payment.captured', captured(a.number, a.total));
    await send('payment.captured', captured(b.number, b.total));

    const settle = {
      settlementRef: 'stl_1',
      settledAt: '2026-11-09T10:05:00.000Z',
      payments: [
        { gatewayRef: `pay_${a.number}` },
        { gatewayRef: `pay_${b.number}` },
        { gatewayRef: 'pay_from_before_reset' },
      ],
    };
    expect((await send('settlement.processed', settle)).status).toBe(200);

    const fa = gatewayFee(a.total);
    const fb = gatewayFee(b.total);
    const [event] = await eventsOf('settlement.received');
    expect(event?.payload).toEqual({
      settlementRef: 'stl_1',
      amountPaise:
        a.total - fa.feePaise - fa.feeGstPaise + (b.total - fb.feePaise - fb.feeGstPaise),
      feePaise: fa.feePaise + fa.feeGstPaise + fb.feePaise + fb.feeGstPaise,
      paymentCount: 2,
      settledAt: '2026-11-09T10:05:00.000Z',
    });
    const payments = await db.payment.findMany();
    expect(payments.every((p) => p.settlementRef === 'stl_1' && p.settledAt !== null)).toBe(true);

    // A second batch naming the same payments settles nothing and writes no event.
    await send('settlement.processed', { ...settle, settlementRef: 'stl_2' });
    expect(await eventsOf('settlement.received')).toHaveLength(1);
  });

  it('openPayment asks PayMock with a signed request and the order deadline', async () => {
    const { number, total } = await order();
    let seen: { url: string; raw: string; signed: boolean } | undefined;
    const fetch = (async (url: URL, init: RequestInit) => {
      const raw = String(init.body);
      const sig = (init.headers as Record<string, string>)['X-SG-Signature'];
      seen = { url: String(url), raw, signed: verifyWebhook(SECRET, raw, sig) };
      return Response.json({
        gatewayRef: 'pay_1',
        status: 'created',
        payPath: '/paymock/pay/pay_1',
      });
    }) as unknown as typeof globalThis.fetch;

    const payment = await openPayment(db, number, {
      simUrl: 'http://sim.test',
      returnUrl: 'http://localhost:3000/orders/x',
      fetch,
    });
    expect(payment?.payPath).toBe('/paymock/pay/pay_1');
    expect(seen?.url).toBe('http://sim.test/paymock/v1/payments');
    expect(seen?.signed).toBe(true);
    expect(JSON.parse(seen!.raw)).toEqual({
      orderNumber: number,
      amountPaise: total,
      returnUrl: 'http://localhost:3000/orders/x',
      expiresAt: new Date(PLACED_AT.getTime() + UNPAID_CANCEL_AFTER_MS).toISOString(),
    });

    // Not waiting for payment any more: nothing to open.
    await cancelUnpaidOrders(db, new Date(PLACED_AT.getTime() + UNPAID_CANCEL_AFTER_MS));
    expect(
      await openPayment(db, number, { simUrl: 'http://sim.test', returnUrl: 'x', fetch }),
    ).toBeNull();
  });

  it('openPayment reports PayMock being down', async () => {
    const { number } = await order();
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    await expect(
      openPayment(db, number, { simUrl: 'http://sim.test', returnUrl: 'x', fetch: down }),
    ).rejects.toBeInstanceOf(PaymentUnavailable);
  });
});
