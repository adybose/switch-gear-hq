import { describe, expect, it } from 'vitest';
import { createGenerator } from './generator';

const T0 = Date.parse('2026-11-07T00:00:00Z');
function setup(seed = 42) {
  let now = T0;
  const orders: Record<string, unknown>[] = [];
  const outcomes: string[] = [];
  let fail = false;
  const fetch = (async (url: URL, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/api/v1/catalog/products') return Response.json([{ slug: 'demo' }]);
    if (path === '/api/v1/catalog/products/demo')
      return Response.json({ variants: [{ sku: 'SG-DEMO-CLS-BLK-M' }] });
    if (path === '/api/v1/checkout') {
      orders.push(JSON.parse(String(init?.body)));
      if (fail) throw new Error('connection lost');
      return Response.json(
        {
          orderNumber: `ORD-${orders.length}`,
          totalPaise: 67800,
          paymentUrl: 'http://store.test/pay/ORD-1?t=token',
        },
        { status: 201 },
      );
    }
    if (path === '/pay/ORD-1') {
      expect(init?.redirect).toBe('manual');
      return new Response(null, {
        status: 303,
        headers: { location: 'http://public-sim.test/paymock/pay/pay_demo' },
      });
    }
    throw new Error(`unexpected ${path}`);
  }) as typeof globalThis.fetch;
  const generator = createGenerator({
    clock: { now: () => new Date(now), speed: () => 144 },
    seed,
    storeUrl: 'http://store.test',
    fetch,
    paymock: {
      choose: async (_ref, outcome) => {
        outcomes.push(outcome);
        return { status: 'captured' };
      },
    },
  });
  return {
    generator,
    orders,
    outcomes,
    advance: (ms: number) => {
      now += ms;
    },
    fail: () => {
      fail = true;
    },
  };
}

describe('order generator', () => {
  it('is off initially; produces 30 orders per business day; stopping drops missed time', async () => {
    const s = setup();
    await s.generator.tick();
    expect(s.orders).toHaveLength(0);
    s.generator.configure({ enabled: true });
    for (let i = 0; i < 30; i++) {
      s.advance(2_880_000);
      await s.generator.tick();
    }
    expect(s.orders).toHaveLength(30);
    expect(s.orders[0]).toMatchObject({
      source: 'generator',
      customer: { email: expect.stringMatching(/@example\.com$/), phone: '0000000000' },
    });
    s.generator.configure({ enabled: false });
    s.advance(86_400_000);
    s.generator.configure({ enabled: true });
    await s.generator.tick();
    expect(s.orders).toHaveLength(30);
    s.advance(2_880_000);
    await s.generator.tick();
    expect(s.orders).toHaveLength(31);
  });

  it('replays carts and 95/4/1 outcomes from the same seed', async () => {
    const a = setup(123),
      b = setup(123),
      c = setup(124);
    for (const s of [a, b, c]) {
      s.generator.configure({ enabled: true });
      for (let i = 0; i < 100; i++) {
        s.advance(2_880_000);
        await s.generator.tick();
      }
    }
    expect(a.orders).toEqual(b.orders);
    expect(a.outcomes).toEqual(b.outcomes);
    expect(a.orders).not.toEqual(c.orders);
    expect(a.outcomes.filter((x) => x === 'success')).toHaveLength(95);
    expect(a.outcomes.filter((x) => x === 'failure')).toHaveLength(4);
    expect(a.outcomes.filter((x) => x === 'pending')).toHaveLength(1);
  });

  it('serializes concurrent ticks and reports an ambiguous checkout without retrying it', async () => {
    const s = setup();
    s.generator.configure({ enabled: true });
    s.advance(2_880_000);
    s.fail();
    await Promise.all([s.generator.tick(), s.generator.tick(), s.generator.tick()]);
    expect(s.orders).toHaveLength(1);
    expect(s.generator.status()).toMatchObject({
      failed: 1,
      completed: 0,
      lastError: expect.stringContaining('connection lost'),
    });
    await s.generator.tick();
    expect(s.orders).toHaveLength(1);
    expect(() => s.generator.configure({ seed: 2 })).toThrow();
    s.generator.configure({ enabled: false });
    s.generator.configure({ seed: 2 });
    expect(s.generator.status()).toMatchObject({ seed: 2, failed: 0 });
  });
});

it('stops future work but finishes the in-flight payment; reseed waits for idle', async () => {
  let release!: () => void;
  let checkoutStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    checkoutStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let now = T0;
  const outcomes: string[] = [];
  const generator = createGenerator({
    seed: 1,
    storeUrl: 'http://store.test',
    clock: { now: () => new Date(now), speed: () => 144 },
    fetch: (async (url: URL) => {
      const path = new URL(url).pathname;
      if (path === '/api/v1/catalog/products') return Response.json([{ slug: 'demo' }]);
      if (path === '/api/v1/catalog/products/demo')
        return Response.json({ variants: [{ sku: 'SG-DEMO-CLS-BLK-M' }] });
      if (path === '/api/v1/checkout') {
        checkoutStarted();
        await blocked;
        return Response.json({
          orderNumber: 'ORD-1',
          paymentUrl: 'http://store.test/pay/ORD-1?t=x',
        });
      }
      return new Response(null, {
        status: 303,
        headers: { location: 'http://sim.test/paymock/pay/pay_demo' },
      });
    }) as typeof globalThis.fetch,
    paymock: {
      choose: async (_ref, outcome) => {
        outcomes.push(outcome);
        return { status: 'captured' };
      },
    },
  });
  generator.configure({ enabled: true });
  now += 2_880_000;
  const work = generator.tick();
  await started;
  generator.configure({ enabled: false });
  expect(() => generator.configure({ seed: 2 })).toThrow();
  release();
  await work;
  expect(outcomes).toHaveLength(1);
  expect(generator.status()).toMatchObject({ enabled: false, busy: false, completed: 1 });
  generator.configure({ seed: 2 });
  expect(generator.status()).toMatchObject({ seed: 2, completed: 0 });
});
