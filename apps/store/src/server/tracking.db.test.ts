import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../../packages/sg-cli/src/cli';
import { GET as track } from '../app/api/v1/orders/track/route';
import { GET as listTickets, POST as postTicket } from '../app/api/v1/tickets/route';
import { loadOrCreateKeys } from './api-keys';
import { placeOrder } from './checkout';
import { createDb, type Db } from './db';
import { recordEvent } from './events';
import { resetDemo } from './seed/seed';
import { trackOrder } from './tracking';
import { checkoutInput } from './validation/checkout';

// Needs a migrated Postgres (DATABASE_URL). Resets the database to the demo seed state.
describe.skipIf(!process.env.DATABASE_URL)('order tracking and contact form (database)', () => {
  let db: Db;
  const NOW = new Date('2026-11-07T10:00:00.000Z');
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-tracking-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };
  const customer = {
    name: 'Asha Rao',
    email: 'Asha.Rao@example.com',
    phone: '9876543210',
    address: '12 Test Layout',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560034',
  };

  const place = async () =>
    (
      await placeOrder(
        db,
        checkoutInput.parse({ items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 }], customer }),
        NOW,
      )
    ).orderNumber;

  const trackUrl = (number: string, email: string) =>
    new Request(
      `http://localhost/api/v1/orders/track?number=${number}&email=${encodeURIComponent(email)}`,
    );
  const ticketRequest = (body: unknown) =>
    new Request('http://localhost/api/v1/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const listRequest = (department?: string, query = '') => {
    const keys = loadOrCreateKeys(options.keysPath).keys;
    return new Request(`http://localhost/api/v1/tickets${query}`, {
      headers: department
        ? { authorization: `Bearer ${keys[department as keyof typeof keys]}` }
        : {},
    });
  };

  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('finds an order by number and email, ignoring email case', async () => {
    const number = await place();
    const found = await trackOrder(db, number, 'asha.rao@EXAMPLE.com');
    expect(found).toMatchObject({ number, status: 'placed', awb: null, invoiceNumber: null });
    expect(found!.timeline.map((t) => t.label)).toEqual(['Order placed']);
  });

  it('answers a wrong email or unknown number the same way (404)', async () => {
    const number = await place();
    expect(await trackOrder(db, number, 'someone.else@example.com')).toBeNull();
    expect(await trackOrder(db, 'ORD-9999', 'asha.rao@example.com')).toBeNull();
    const wrong = await track(trackUrl(number, 'someone.else@example.com'));
    const missing = await track(trackUrl('ORD-9999', 'asha.rao@example.com'));
    expect(wrong.status).toBe(404);
    expect(await wrong.json()).toEqual(await missing.json());
    expect((await track(trackUrl(number, 'asha.rao@example.com'))).status).toBe(200);
  });

  it('builds the timeline from order and shipment events, in order, and shows the AWB', async () => {
    const number = await place();
    const order = await db.order.findUniqueOrThrow({ where: { number } });
    await db.$transaction(async (tx) => {
      await recordEvent(tx, {
        type: 'order.paid',
        entityType: 'order',
        entityId: number,
        payload: {
          orderNumber: number,
          totalPaise: order.totalPaise,
          itemCount: 1,
          gstType: 'intra',
          paidAt: NOW.toISOString(),
        },
      });
      await tx.shipment.create({
        data: { orderId: order.id, awb: 'SF123456', zone: 'national', costPaise: 6000 },
      });
      await recordEvent(tx, {
        type: 'shipment.delivered',
        entityType: 'shipment',
        entityId: 'SF123456',
        payload: { orderNumber: number, awb: 'SF123456', deliveredAt: NOW.toISOString() },
      });
      await recordEvent(tx, {
        type: 'approval.requested',
        entityType: 'approval',
        entityId: 'APR-1',
        payload: {
          approvalId: 'APR-1',
          department: 'finance',
          action: 'refund.create',
          amountPaise: null,
          reason: 'test',
        },
      });
    });
    const found = await trackOrder(db, number, customer.email);
    expect(found!.timeline.map((t) => t.label)).toEqual([
      'Order placed',
      'Payment received',
      'Delivered',
    ]);
    expect(found!.awb).toBe('SF123456');
  });

  it('shows a failed payment, which cancels the order without an order.cancelled event', async () => {
    const number = await place();
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { number }, data: { status: 'cancelled' } });
      await recordEvent(tx, {
        type: 'payment.failed',
        entityType: 'order',
        entityId: number,
        payload: {
          orderNumber: number,
          gatewayRef: 'pm_1',
          amountPaise: 59900,
          reason: 'declined',
        },
      });
    });
    const found = await trackOrder(db, number, customer.email);
    expect(found!.status).toBe('cancelled');
    expect(found!.timeline.map((t) => t.label)).toEqual(['Order placed', 'Payment failed']);
  });

  it('creates a ticket linked to the order and writes ticket.created', async () => {
    const number = await place();
    const res = await postTicket(
      ticketRequest({
        email: 'asha.rao@example.com',
        orderNumber: number,
        type: 'return',
        message: 'Too small',
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ticketNumber: 'TCK-1' });

    const ticket = await db.ticket.findUniqueOrThrow({
      where: { number: 'TCK-1' },
      include: { order: true, customer: true },
    });
    expect(ticket).toMatchObject({ type: 'return', status: 'open' });
    expect(ticket.order?.number).toBe(number);
    expect(ticket.customer.email).toBe('asha.rao@example.com');
    expect(ticket.messages).toEqual([
      { from: 'customer', body: 'Too small', at: expect.any(String) },
    ]);

    const events = await db.event.findMany({ where: { type: 'ticket.created' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: 'ticket',
      entityId: 'TCK-1',
      payload: { ticketNumber: 'TCK-1', orderNumber: number, type: 'return' },
    });
  });

  it('does not link an order when the email does not match, and creates a bare customer', async () => {
    const number = await place();
    const res = await postTicket(
      ticketRequest({
        email: 'Stranger@example.com',
        orderNumber: number,
        type: 'wismo',
        message: 'Where?',
      }),
    );
    expect(res.status).toBe(201);
    const ticket = await db.ticket.findUniqueOrThrow({
      where: { number: 'TCK-1' },
      include: { customer: true },
    });
    expect(ticket.orderId).toBeNull();
    expect(ticket.customer.email).toBe('stranger@example.com');
    const event = await db.event.findFirstOrThrow({ where: { type: 'ticket.created' } });
    expect(event.payload).toMatchObject({ orderNumber: null });
  });

  it('works without an order number and rejects bad input with 422', async () => {
    expect(
      (await postTicket(ticketRequest({ email: 'a@example.com', type: 'other', message: 'Hi' })))
        .status,
    ).toBe(201);
    expect(
      (await postTicket(ticketRequest({ email: 'bad', type: 'other', message: 'Hi' }))).status,
    ).toBe(422);
    expect(await db.ticket.count()).toBe(1);
  });

  it('lists contact tickets with their verified order number and messages for support', async () => {
    const number = await place();
    await postTicket(
      ticketRequest({
        email: customer.email,
        orderNumber: number,
        type: 'wismo',
        message: 'Where is my tee?',
      }),
    );
    await postTicket(
      ticketRequest({
        email: 'new@example.com',
        type: 'other',
        message: 'Do you have a size chart?',
      }),
    );
    // Pin queue order independently of the database's clock resolution.
    await db.ticket.update({
      where: { number: 'TCK-1' },
      data: { createdAt: new Date('2026-11-07T10:00:00Z') },
    });
    await db.ticket.update({
      where: { number: 'TCK-2' },
      data: { createdAt: new Date('2026-11-07T10:01:00Z') },
    });

    const response = await listTickets(listRequest('support'));
    expect(response.status).toBe(200);
    const tickets = await response.json();
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toEqual({
      number: 'TCK-2',
      orderNumber: null,
      type: 'other',
      status: 'open',
      messages: [{ from: 'customer', body: 'Do you have a size chart?', at: expect.any(String) }],
    });
    expect(tickets[1]).toEqual({
      number: 'TCK-1',
      orderNumber: number,
      type: 'wismo',
      status: 'open',
      messages: [{ from: 'customer', body: 'Where is my tee?', at: expect.any(String) }],
    });
    // Reading the queue creates no new business events.
    expect(await db.event.count({ where: { type: 'ticket.created' } })).toBe(2);
  });

  it('filters every ticket status and rejects invalid filters', async () => {
    for (const status of ['open', 'waiting', 'closed'] as const) {
      const response = await postTicket(
        ticketRequest({
          email: 'a@example.com',
          type: 'other',
          message: status,
        }),
      );
      const { ticketNumber } = await response.json();
      // Fixture states for follow-up reply/close work; not a production mutation path.
      await db.ticket.update({ where: { number: ticketNumber }, data: { status } });
    }
    for (const status of ['open', 'waiting', 'closed']) {
      const response = await listTickets(listRequest('support', `?status=${status}`));
      expect(response.status).toBe(200);
      const tickets = await response.json();
      expect(tickets).toHaveLength(1);
      expect(tickets[0].status).toBe(status);
    }
    const invalid = await listTickets(listRequest('support', '?status=paid'));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: 'validation_failed' });
  });

  it('requires tickets:read and returns an empty array for an empty queue', async () => {
    expect((await listTickets(listRequest())).status).toBe(401);
    const badKey = new Request('http://localhost/api/v1/tickets', {
      headers: { authorization: 'Bearer sg_support_invalid' },
    });
    expect((await listTickets(badKey)).status).toBe(401);
    for (const department of ['engineering', 'finance', 'fulfilment', 'marketing']) {
      expect((await listTickets(listRequest(department))).status).toBe(403);
    }
    for (const department of ['support', 'hq', 'founder']) {
      const response = await listTickets(listRequest(department));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    }
  });

  it('sg tickets list reads the real route with the support key, including JSON output', async () => {
    await postTicket(
      ticketRequest({
        email: 'a@example.com',
        type: 'complaint',
        message: 'Print is crooked',
      }),
    );
    const env = {
      SG_API_URL: 'http://localhost/api/v1',
      SG_API_KEY: loadOrCreateKeys(options.keysPath).keys.support,
    };
    const fetchRoute: typeof fetch = async (input, init) =>
      listTickets(new Request(String(input), init));
    const deps = { env, cwd: options.keysPath, fetch: fetchRoute };
    expect(await run(['tickets', 'list', '--status', 'open'], deps)).toEqual({
      code: 0,
      out: 'TCK-1  orderNumber=-  type=complaint  status=open',
    });
    const json = await run(['tickets', 'list', '--json'], deps);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toMatchObject([{ number: 'TCK-1', type: 'complaint' }]);
    expect(await run(['tickets', 'list', '--status', 'closed'], deps)).toEqual({
      code: 0,
      out: 'Nothing found.',
    });
  });
});
