import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSim, type SimApp } from '../../../sim/src/app';
import { GET as list } from '../app/api/v1/catalog/products/route';
import { GET as detail } from '../app/api/v1/catalog/products/[slug]/route';
import { POST as checkout } from '../app/api/v1/checkout/route';
import { GET as pay } from '../app/pay/[number]/route';
import { POST as webhook } from '../app/api/v1/webhooks/[partner]/route';
import { getDb, type Db } from './db';
import { resetDemo } from './seed/seed';

// Real route handlers, services, signed webhooks and Postgres; only HTTP transport is injected.
describe.skipIf(!process.env.DATABASE_URL)('generated checkout and payment (database)', () => {
  let db: Db;
  let sim: SimApp;
  let now = Date.now();
  let realFetch: typeof globalThis.fetch;
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-generator-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };
  beforeAll(async () => {
    db = getDb();
    await resetDemo(db, options);
    realFetch = globalThis.fetch;
    const transport = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const request = new Request(url, init);
      if (url.pathname === '/api/v1/catalog/products') return list(request);
      if (url.pathname.startsWith('/api/v1/catalog/products/'))
        return detail(request, {
          params: Promise.resolve({ slug: url.pathname.split('/').at(-1)! }),
        });
      if (url.pathname === '/api/v1/checkout') return checkout(request);
      if (url.pathname.startsWith('/pay/'))
        return pay(request, {
          params: Promise.resolve({ number: url.pathname.split('/').at(-1)! }),
        });
      if (url.pathname.startsWith('/api/v1/webhooks/'))
        return webhook(request, { params: Promise.resolve({ partner: 'paymock' }) });
      if (url.pathname.startsWith('/paymock/') || url.pathname === '/sim/clock') {
        const result = await sim.app.inject({
          method: (init?.method ?? 'GET') as 'GET' | 'POST',
          url: url.pathname,
          headers: init?.headers as Record<string, string>,
          ...(init?.body ? { payload: String(init.body) } : {}),
        });
        return new Response(result.body, {
          status: result.statusCode,
          headers: result.headers as Record<string, string>,
        });
      }
      throw new Error(`Unexpected HTTP ${url.pathname}`);
    }) as typeof globalThis.fetch;
    globalThis.fetch = transport;
    sim = buildSim(
      {
        clock: { now: () => new Date(now), speed: () => 144 },
        fetch: transport,
        storeUrl: 'http://store.test',
        settleEveryMs: 0,
        schedule: () => {},
      },
      {},
      {},
      { tickEveryMs: 0 },
    );
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await sim?.app.close();
    await resetDemo(db, options);
    await db.$disconnect();
  });
  it('catalogue hides drafts and inactive variants, supports collection and unknown-slug 404', async () => {
    const product = await db.product.findUniqueOrThrow({
      where: { slug: 'silk-board-survivor' },
      include: { variants: true },
    });
    await db.variant.update({ where: { id: product.variants[0]!.id }, data: { active: false } });
    const response = await detail(new Request('http://store.test'), {
      params: Promise.resolve({ slug: product.slug }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artworkUrl).toBe('/artwork/silk-board-survivor.svg');
    expect(body.variants).toHaveLength(89);
    await db.product.update({ where: { id: product.id }, data: { status: 'draft' } });
    expect(
      (
        await detail(new Request('http://store.test'), {
          params: Promise.resolve({ slug: product.slug }),
        })
      ).status,
    ).toBe(404);
    const all = await (
      await list(
        new Request('http://store.test/api/v1/catalog/products?collection=namma-bengaluru'),
      )
    ).json();
    expect(all).toHaveLength(2);
    expect(
      (
        await detail(new Request('http://store.test'), {
          params: Promise.resolve({ slug: 'missing' }),
        })
      ).status,
    ).toBe(404);
    await db.product.update({ where: { id: product.id }, data: { status: 'published' } });
  });
  it('100 generated orders pass checkout pricing and signed 95/4/1 payments with outbox events', async () => {
    sim.generator.configure({ seed: 123, enabled: true });
    for (let i = 0; i < 100; i++) {
      now += 2_880_000;
      await sim.generator.tick();
    }
    sim.generator.configure({ enabled: false });
    expect(sim.generator.status()).toMatchObject({ completed: 100, failed: 0, lastError: null });
    const orders = await db.order.findMany({
      include: { customer: true, items: true, payments: true },
    });
    expect(orders).toHaveLength(100);
    expect(orders.filter((o) => o.status === 'paid')).toHaveLength(95);
    expect(orders.filter((o) => o.status === 'cancelled')).toHaveLength(4);
    expect(orders.filter((o) => o.status === 'placed')).toHaveLength(1);
    expect(
      orders.every(
        (o) =>
          o.source === 'generator' &&
          o.customer.email.endsWith('@example.com') &&
          o.totalPaise > 0 &&
          o.items.length > 0,
      ),
    ).toBe(true);
    expect(await db.event.count({ where: { type: 'order.placed' } })).toBe(100);
    expect(await db.event.count({ where: { type: 'order.paid' } })).toBe(95);
    expect(await db.event.count({ where: { type: 'payment.failed' } })).toBe(4);
  }, 30_000);
});
