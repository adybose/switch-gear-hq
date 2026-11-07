import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as listRoute } from '../app/api/v1/orders/route';
import { GET as getRoute } from '../app/api/v1/orders/[number]/route';
import { POST as cancelRoute } from '../app/api/v1/orders/[number]/cancel/route';
import { parseKeysFile } from './api-keys';
import { placeOrder } from './checkout';
import { createDb, type Db } from './db';
import { handleCaptured } from './paymock';
import { resetDemo } from './seed/seed';
import { checkoutInput } from './validation/checkout';

type Schema = {
  $ref?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: string[];
};
const spec = parse(
  readFileSync(fileURLToPath(new URL('../../../../api/openapi.yaml', import.meta.url)), 'utf8'),
) as { components: { schemas: Record<string, Schema> } };

/** Minimal OpenAPI schema check (type, nullability, required, enum, items); returns problems. */
function violations(value: unknown, schema: Schema, path = 'order'): string[] {
  if (schema.$ref)
    return violations(value, spec.components.schemas[schema.$ref.split('/').pop()!]!, path);
  if (schema.enum && !schema.enum.includes(value as string))
    return [`${path}: ${String(value)} not in enum`];
  const types = [schema.type ?? []].flat();
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const okType = (t: string) =>
    t === actual ||
    (t === 'integer' && Number.isInteger(value)) ||
    (t === 'number' && actual === 'number');
  if (types.length && !types.some(okType)) return [`${path}: ${actual} is not ${types.join('|')}`];
  const out: string[] = [];
  if (actual === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in obj)) out.push(`${path}.${k}: missing`);
    for (const [k, sub] of Object.entries(schema.properties ?? {}))
      if (k in obj) out.push(...violations(obj[k], sub, `${path}.${k}`));
  }
  if (actual === 'array' && schema.items)
    (value as unknown[]).forEach((v, i) =>
      out.push(...violations(v, schema.items!, `${path}[${i}]`)),
    );
  return out;
}

describe.skipIf(!process.env.DATABASE_URL)('orders read and cancel (database)', () => {
  let db: Db;
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-orders-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };
  let keys: Record<string, string>;
  const req = (key?: string, method = 'GET', url = 'http://store.test/api/v1/orders') =>
    new Request(url, { method, headers: key ? { authorization: `Bearer ${key}` } : {} });
  const params = (number: string) => ({ params: Promise.resolve({ number }) });
  async function order(paid: boolean) {
    const { orderNumber } = await placeOrder(
      db,
      checkoutInput.parse({
        items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 }],
        customer: {
          name: 'Demo Orders',
          email: 'demo.orders@example.com',
          phone: '9876543210',
          address: '1 Test Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560034',
        },
      }),
      new Date('2026-11-07T10:00:00Z'),
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
          capturedAt: '2026-11-07T10:01:00Z',
        }),
      );
    return { number: orderNumber, id: row.id, total: row.totalPaise };
  }
  const cancel = (number: string, key = keys.fulfilment) =>
    cancelRoute(req(key, 'POST'), params(number));

  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    keys = parseKeysFile(readFileSync(options.keysPath, 'utf8'));
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('enforces department scopes on all three endpoints', async () => {
    const o = await order(true);
    expect((await listRoute(req())).status).toBe(401);
    expect((await cancelRoute(req(undefined, 'POST'), params(o.number))).status).toBe(401);
    for (const d of ['finance', 'marketing', 'engineering']) {
      expect((await listRoute(req(keys[d]))).status, d).toBe(403);
      expect((await getRoute(req(keys[d]), params(o.number))).status, d).toBe(403);
    }
    for (const d of ['support', 'hq', 'founder', 'finance', 'marketing', 'engineering']) {
      expect((await cancel(o.number, keys[d])).status, d).toBe(403);
    }
    for (const d of ['fulfilment', 'support', 'hq', 'founder']) {
      expect((await listRoute(req(keys[d]))).status, d).toBe(200);
      expect((await getRoute(req(keys[d]), params(o.number))).status, d).toBe(200);
    }
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('paid');
  });

  it('lists and filters orders, validates query, returns 404 for unknown number', async () => {
    const paid = await order(true);
    const placed = await order(false);
    const all = await (await listRoute(req(keys.support))).json();
    expect(all.map((x: { number: string }) => x.number)).toEqual(
      expect.arrayContaining([paid.number, placed.number]),
    );
    const only = await (
      await listRoute(
        req(keys.support, 'GET', 'http://store.test/api/v1/orders?status=placed&limit=1'),
      )
    ).json();
    expect(only).toHaveLength(1);
    expect(only[0].number).toBe(placed.number);
    for (const q of ['status=bogus', 'limit=0', 'limit=201'])
      expect(
        (await listRoute(req(keys.support, 'GET', `http://store.test/api/v1/orders?${q}`))).status,
        q,
      ).toBe(422);
    const one = await (await getRoute(req(keys.support), params(paid.number))).json();
    expect(one).toMatchObject({
      number: paid.number,
      status: 'paid',
      totalPaise: paid.total,
      items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 }],
      printJob: null,
      shipment: null,
    });
    expect(one.timeline.map((t: { status: string }) => t.status)).toContain('paid');
    expect(JSON.stringify(one)).not.toContain('demo.orders@example.com');
    expect((await getRoute(req(keys.support), params('ORD-999999'))).status).toBe(404);
  });

  it('responses match the Order schema, including null print job, shipment and invoice', async () => {
    const o = await order(true);
    const unprinted = await (await getRoute(req(keys.support), params(o.number))).json();
    expect(unprinted).toMatchObject({ printJob: null, shipment: null, invoiceNumber: null });
    const order_ = spec.components.schemas.Order!;
    expect(violations(unprinted, order_)).toEqual([]);
    const cancelled = await (await cancel(o.number)).json();
    expect(violations(cancelled, order_)).toEqual([]);
    expect(cancelled.timeline.map((x: { status: string }) => x.status)).toContain('cancelled');

    const p = await order(true);
    await db.printJob.create({ data: { orderId: p.id, costPaise: 100, partnerRef: 'pj_c' } });
    await db.shipment.create({ data: { orderId: p.id, zone: 'same_city', costPaise: 50 } });
    const full = await (await getRoute(req(keys.support), params(p.number))).json();
    expect(full.printJob).toMatchObject({ partnerRef: 'pj_c', status: 'received', attempt: 1 });
    expect(full.shipment).toMatchObject({ awb: null, sequence: 1 });
    expect(violations(full, order_)).toEqual([]);
    for (const row of await (await listRoute(req(keys.support))).json())
      expect(violations(row, order_), row.number).toEqual([]);
  });

  it('cancels a paid order before printing: full refund record and events', async () => {
    const o = await order(true);
    const res = await cancel(o.number);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('cancelled');
    const refunds = await db.refund.findMany({ where: { orderId: o.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountPaise: o.total, status: 'requested' });
    const events = await db.event.findMany({
      where: { type: { in: ['order.cancelled', 'refund.requested'] } },
    });
    expect(events.map((e) => e.type).sort()).toEqual(['order.cancelled', 'refund.requested']);
    expect((await cancel(o.number)).status).toBe(409);
    expect(await db.refund.count({ where: { orderId: o.id } })).toBe(1);
  });

  it('cancels a placed order without a refund', async () => {
    const o = await order(false);
    expect((await cancel(o.number)).status).toBe(200);
    expect(await db.refund.count({ where: { orderId: o.id } })).toBe(0);
    expect(await db.event.count({ where: { type: 'refund.requested' } })).toBe(0);
  });

  it('refuses once printing has started or the order is past paid, and 404s unknown', async () => {
    const o = await order(true);
    await db.printJob.create({ data: { orderId: o.id, costPaise: 100, partnerRef: 'pj_x' } });
    expect((await cancel(o.number)).status).toBe(409);
    await db.order.update({ where: { id: o.id }, data: { status: 'printing' } });
    expect((await cancel(o.number)).status).toBe(409);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('printing');
    expect(await db.refund.count()).toBe(0);
    expect((await cancel('ORD-999999')).status).toBe(404);
  });

  it('only one of two parallel cancels wins', async () => {
    const o = await order(true);
    const statuses = (await Promise.all([cancel(o.number), cancel(o.number)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 409]);
    expect(await db.refund.count({ where: { orderId: o.id } })).toBe(1);
  });
});
