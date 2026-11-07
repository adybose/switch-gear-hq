import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CheckoutError, getOrderSummary, placeOrder, quoteCheckout } from './checkout';
import { createDb, type Db } from './db';
import { resetDemo } from './seed/seed';
import { checkoutInput, type CheckoutInput } from './validation/checkout';

// Needs a migrated Postgres (DATABASE_URL). Resets the database to the demo seed state.
describe.skipIf(!process.env.DATABASE_URL)('checkout (database)', () => {
  let db: Db;
  const NOW = new Date('2026-11-07T10:00:00.000Z');
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-checkout-')), '.env.local.keys'),
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

  const input = (overrides: Partial<CheckoutInput> = {}): CheckoutInput =>
    checkoutInput.parse({
      items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 }],
      customer,
      ...overrides,
    });

  async function addCode(code: string, percent: number, extra: object = {}) {
    await db.discountCode.create({
      data: {
        code,
        percent,
        startsAt: new Date('2026-11-01T00:00:00Z'),
        endsAt: new Date('2026-11-08T00:00:00Z'),
        status: 'active',
        ...extra,
      },
    });
  }

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

  it('places an order: customer, items, totals, status placed and order.placed', async () => {
    const { orderNumber, pricing } = await placeOrder(db, input(), NOW);
    expect(orderNumber).toBe('ORD-1001');
    expect(pricing.totalPaise).toBe(67800);

    const order = await db.order.findUniqueOrThrow({
      where: { number: orderNumber },
      include: { items: true, customer: true },
    });
    expect(order).toMatchObject({
      status: 'placed',
      subtotalPaise: 59900,
      discountPaise: 0,
      shippingPaise: 7900,
      taxPaise: 3229,
      totalPaise: 67800,
      source: 'web',
      placedAt: NOW,
    });
    expect(order.items).toMatchObject([{ qty: 1, unitPricePaise: 59900 }]);
    expect(order.customer.email).toBe('asha.rao@example.com');

    const events = await db.event.findMany({ where: { entityId: orderNumber } });
    expect(events).toMatchObject([
      {
        type: 'order.placed',
        entityType: 'order',
        payload: { orderNumber, totalPaise: 67800, itemCount: 1, source: 'web' },
      },
    ]);
  });

  it('numbers orders in sequence and restarts after a demo reset', async () => {
    expect((await placeOrder(db, input(), NOW)).orderNumber).toBe('ORD-1001');
    expect((await placeOrder(db, input(), NOW)).orderNumber).toBe('ORD-1002');
    await resetDemo(db, options);
    expect((await placeOrder(db, input(), NOW)).orderNumber).toBe('ORD-1001');
  });

  it('a second order with the same email never changes the first order', async () => {
    const first = await placeOrder(db, input(), NOW);
    const second = await placeOrder(
      db,
      input({
        customer: {
          name: 'Someone Else',
          email: 'asha.rao@EXAMPLE.com',
          phone: '9000000001',
          address: '9 Other Road',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110001',
        },
      }),
      NOW,
    );

    const firstOrder = await getOrderSummary(db, first.orderNumber);
    expect(firstOrder).toMatchObject({
      shipName: 'Asha Rao',
      shipCity: 'Bengaluru',
      shipState: 'Karnataka',
      shipPincode: '560034',
    });
    const secondOrder = await getOrderSummary(db, second.orderNumber);
    expect(secondOrder).toMatchObject({ shipName: 'Someone Else', shipCity: 'New Delhi' });
    expect(second.pricing.gstType).toBe('inter'); // GST follows each order's own state

    // Both orders link to one customer, whose details are never overwritten.
    const customers = await db.customer.findMany();
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ name: 'Asha Rao', city: 'Bengaluru' });
    expect(await db.order.count({ where: { customerId: customers[0]!.id } })).toBe(2);
  });

  it('prices from the catalogue and merges repeated SKUs', async () => {
    const { orderNumber, pricing } = await placeOrder(
      db,
      input({
        items: [
          { sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 2 },
          { sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 },
        ],
      }),
      NOW,
    );
    expect(pricing).toMatchObject({ itemCount: 3, discountSource: 'bundle', totalPaise: 161730 });
    const items = await db.orderItem.findMany({ where: { order: { number: orderNumber } } });
    expect(items).toMatchObject([{ qty: 3, unitPricePaise: 59900 }]);
  });

  it('applies an active code and records it on the order', async () => {
    await addCode('KAAPI15', 15);
    const { orderNumber, pricing } = await placeOrder(
      db,
      input({ items: [{ sku: 'SG-KAAPIBREAK-PRM-WHT-S', qty: 1 }], discountCode: 'kaapi15' }),
      NOW,
    );
    expect(pricing).toMatchObject({ discountPaise: 14985, totalPaise: 92815 });
    expect(
      (await db.order.findUniqueOrThrow({ where: { number: orderNumber } })).discountCode,
    ).toBe('KAAPI15');
  });

  it('rejects expired, future and unapproved codes', async () => {
    await addCode('OLD', 10, { endsAt: new Date('2026-11-05T00:00:00Z') });
    await addCode('SOON', 10, { startsAt: new Date('2026-11-09T00:00:00Z'), endsAt: null });
    await addCode('BIG', 50, { status: 'pending_approval' });
    for (const code of ['OLD', 'SOON', 'BIG', 'NOPE']) {
      await expect(placeOrder(db, input({ discountCode: code }), NOW)).rejects.toMatchObject({
        code: 'discount_code_invalid',
        field: 'discountCode',
      });
    }
    expect(await db.order.count()).toBe(0);
  });

  it('blocks a PIN code ShipFast does not serve, with a clear message', async () => {
    const error = await placeOrder(
      db,
      input({ customer: { ...customer, state: 'Andaman and Nicobar Islands', pincode: '744101' } }),
      NOW,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CheckoutError);
    expect(error).toMatchObject({
      code: 'not_serviceable',
      field: 'customer.pincode',
      message:
        "Sorry, our courier doesn't deliver to PIN 744101 (Andaman and Nicobar Islands) yet.",
    });
    expect(await db.order.count()).toBe(0);
    expect(await db.customer.count()).toBe(0);
  });

  it('rejects unknown, inactive and unpublished SKUs', async () => {
    await db.variant.update({ where: { sku: 'SG-LOGO-CLS-WHT-M' }, data: { active: false } });
    await db.product.update({ where: { slug: 'off-by-one' }, data: { status: 'draft' } });
    for (const sku of ['SG-NOPE-CLS-BLK-M', 'SG-LOGO-CLS-WHT-M', 'SG-OFFBYONE-CLS-BLK-M']) {
      await expect(placeOrder(db, input({ items: [{ sku, qty: 1 }] }), NOW)).rejects.toMatchObject({
        code: 'unknown_sku',
      });
    }
  });

  it('rejects more than 10 of one SKU across lines', async () => {
    await expect(
      placeOrder(
        db,
        input({
          items: [
            { sku: 'SG-LOGO-CLS-WHT-M', qty: 6 },
            { sku: 'SG-LOGO-CLS-WHT-M', qty: 5 },
          ],
        }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'too_many' });
  });

  it('quotes without failing on a bad code or PIN', async () => {
    const quote = await quoteCheckout(
      db,
      {
        items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 3 }],
        discountCode: 'NOPE',
        pincode: '744101',
      },
      NOW,
    );
    expect(quote.pricing.totalPaise).toBe(161730);
    expect(quote.discountCodeError).toMatch(/NOPE isn't valid/);
    expect(quote.shipping).toMatchObject({ serviceable: false, reason: 'not_serviceable' });
    expect(await db.order.count()).toBe(0);
  });
});
