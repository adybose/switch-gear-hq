import type { SimClock } from './clock';
import type { Outcome } from './paymock';

const INTERVAL_MS = 86_400_000 / 30;
// Fictional people/addresses only. PINs identify serviceable city areas, not real customers.
const CITIES = [
  ['Bengaluru', 'Karnataka', '560034'],
  ['Mysuru', 'Karnataka', '570001'],
  ['Chennai', 'Tamil Nadu', '600001'],
  ['Hyderabad', 'Telangana', '500001'],
  ['Mumbai', 'Maharashtra', '400001'],
  ['New Delhi', 'Delhi', '110001'],
  ['Pune', 'Maharashtra', '411001'],
  ['Kolkata', 'West Bengal', '700001'],
] as const;

// Mulberry32: repeatable across Node versions; independent of partner failure randomness.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratorOptions {
  clock: SimClock;
  storeUrl: string;
  seed: number;
  fetch?: typeof globalThis.fetch;
  paymock: {
    choose(ref: string, outcome: Outcome): Promise<{ status: string } | undefined>;
  };
}

export interface GeneratorConfig {
  enabled?: boolean;
  seed?: number;
}

export function createGenerator(options: GeneratorOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;
  let seed = options.seed;
  let random = seeded(seed);
  let enabled = false;
  let busy = false;
  let nextAt: number | null = null;
  let attempted = 0;
  let completed = 0;
  let failed = 0;
  let lastError: string | null = null;
  let lastOrder: string | null = null;
  let bag: Outcome[] = [];
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;

  function outcome(): Outcome {
    if (bag.length === 0) {
      bag = [
        ...Array<Outcome>(95).fill('success'),
        ...Array<Outcome>(4).fill('failure'),
        'pending',
      ];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
    }
    return bag.pop()!;
  }

  function status() {
    return {
      enabled,
      seed,
      ordersPerDay: 30,
      busy,
      attempted,
      completed,
      failed,
      lastError,
      lastOrder,
      nextAt: nextAt === null ? null : new Date(nextAt).toISOString(),
    };
  }

  function configure(config: GeneratorConfig) {
    if (config.seed !== undefined) {
      if (enabled || busy)
        throw new Error('Stop generation and wait for the current order before reseeding');
      if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 4294967295) {
        throw new Error('Seed must be an unsigned 32-bit integer');
      }
      seed = config.seed;
      random = seeded(seed);
      bag = [];
      attempted = completed = failed = 0;
      lastError = lastOrder = null;
    }
    if (config.enabled !== undefined && config.enabled !== enabled) {
      enabled = config.enabled;
      nextAt = enabled ? options.clock.now().getTime() + INTERVAL_MS : null;
    }
    return status();
  }

  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const res = await doFetch(new URL(path, options.storeUrl), {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function placeAndPay() {
    const products = (await json('/api/v1/catalog/products')) as { slug: string }[];
    const slugs = products.map((p) => p.slug).sort();
    if (!slugs.length) throw new Error('No published products available');
    const product = (await json(`/api/v1/catalog/products/${encodeURIComponent(pick(slugs))}`)) as {
      variants: { sku: string }[];
    };
    const skus = product.variants.map((v) => v.sku).sort();
    if (!skus.length) throw new Error('No active variants available');
    const [city, state, pincode] = pick(CITIES);
    const selectedOutcome = outcome();
    const body = {
      source: 'generator',
      items: [{ sku: pick(skus), qty: pick([1, 1, 1, 2, 3]) }],
      customer: {
        name: `Demo Customer ${seed}-${attempted}`,
        email: `demo-${seed}-${attempted}@example.com`,
        phone: '0000000000',
        address: `${attempted} Fictional Demo Street`,
        city,
        state,
        pincode,
      },
    };
    const checkout = (await json('/api/v1/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })) as { orderNumber: string; paymentUrl: string };
    lastOrder = checkout.orderNumber;
    // Use the returned token/path but our configured internal host (Docker's public URL differs).
    const payment = new URL(checkout.paymentUrl);
    if (!/^\/pay\/ORD-\d+$/.test(payment.pathname)) throw new Error('Unexpected payment URL');
    const opened = await doFetch(new URL(payment.pathname + payment.search, options.storeUrl), {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const location = opened.headers.get('location');
    const match =
      location &&
      new URL(location, options.storeUrl).pathname.match(/^\/paymock\/pay\/(pay_[A-Za-z0-9]+)$/);
    if (opened.status !== 303 || !match) throw new Error('Store could not open PayMock payment');
    const paid = await options.paymock.choose(match[1]!, selectedOutcome);
    if (!paid || !['captured', 'failed', 'pending'].includes(paid.status)) {
      throw new Error('PayMock did not accept the outcome');
    }
  }

  async function tick(): Promise<void> {
    const now = options.clock.now().getTime();
    if (!enabled || busy || nextAt === null || now < nextAt) return;
    busy = true;
    // No burst after downtime, and no automatic retry of an ambiguous checkout.
    nextAt = now + INTERVAL_MS;
    attempted++;
    try {
      await placeAndPay();
      completed++;
      lastError = null;
    } catch (err) {
      failed++;
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  configure({ seed });
  return { tick, configure, status };
}

export type OrderGenerator = ReturnType<typeof createGenerator>;
