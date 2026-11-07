import { signWebhook, SIGNATURE_HEADER, verifyWebhook } from '@switch-gear/shared/webhooks';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSim, type SimApp } from './app';

const DAY = 86_400_000;
const secret = 'test_printhub_secret';
const body = (orderRef = 'order1') => ({
  orderRef,
  orderNumber: 'ORD-1001',
  attempt: 1,
  items: [
    {
      sku: 'SG-TEST-CLS-BLK-M',
      fit: 'classic',
      colour: 'black',
      size: 'M',
      qty: 2,
      artworkUrl: 'http://store.test/art.svg',
    },
  ],
  shipTo: {
    name: 'Demo',
    phone: '9876543210',
    address: '1 Test Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560034',
  },
});

describe('PrintHub', () => {
  let sim: SimApp;
  let now: number;
  let events: { raw: string; signature: string }[];
  let answer: number;
  function setup(random = () => 0.5) {
    now = Date.parse('2026-11-07T10:00:00Z');
    events = [];
    answer = 200;
    sim = buildSim(
      {
        clock: { now: () => new Date(now), speed: () => 144 },
        settleEveryMs: 0,
        fetch: (async (_url, init) => {
          events.push({
            raw: String(init?.body),
            signature: (init?.headers as Record<string, string>)[SIGNATURE_HEADER]!,
          });
          return new Response(answer === 409 ? '{"error":"unknown_printjob"}' : '{}', {
            status: answer,
          });
        }) as typeof fetch,
      },
      { random, tickEveryMs: 0 },
    );
  }
  const create = (data: unknown = body(), signed = true) => {
    const raw = JSON.stringify(data);
    return sim.app.inject({
      method: 'POST',
      url: '/printhub/v1/print-jobs',
      payload: raw,
      headers: {
        'content-type': 'application/json',
        ...(signed ? { [SIGNATURE_HEADER]: signWebhook(secret, raw) } : {}),
      },
    });
  };
  afterEach(async () => {
    await sim?.app.close();
  });

  it('accepts signed jobs idempotently, prices each tee and reports every status in order', async () => {
    setup();
    expect((await create(body(), false)).statusCode).toBe(401);
    const res = await create();
    expect(res.statusCode).toBe(201);
    const job = res.json();
    expect(job).toMatchObject({ status: 'received', costPaise: 52000 });
    expect((await create()).json().partnerRef).toBe(job.partnerRef);
    now += 2 * DAY;
    await sim.printhub.tick();
    expect(events.map((e) => JSON.parse(e.raw).data.status)).toEqual([
      'received',
      'in_production',
      'quality_check',
      'packed',
      'handed_over',
    ]);
    expect(events.every((e) => verifyWebhook(secret, e.raw, e.signature))).toBe(true);
    expect((await sim.app.inject('/sim/clock')).json()).toEqual({
      now: new Date(now).toISOString(),
      speed: 144,
    });
  });

  it('samples misprints per item at the 3% boundary and makes partner reprints free', async () => {
    let draws = [0.03, 0.029];
    setup(() => draws.shift() ?? 0.5);
    const job = (await create()).json();
    now += 2 * DAY;
    await sim.printhub.tick();
    expect(events.map((e) => JSON.parse(e.raw).data.status)).toEqual([
      'received',
      'in_production',
      'quality_check',
      'misprint',
    ]);
    const reprint = await create({ ...body(), attempt: 2, reprintOf: job.partnerRef });
    expect(reprint.statusCode).toBe(201);
    expect(reprint.json().costPaise).toBe(0);
    draws = [0.5, 0.5];
    now += 2 * DAY;
    await sim.printhub.tick();
    expect(events.at(-1) && JSON.parse(events.at(-1)!.raw).data.status).toBe('handed_over');
  });

  it('rejects invalid artwork and produces blank stock failures', async () => {
    setup();
    const data = body();
    data.items[0]!.artworkUrl = 'missing-artwork';
    expect((await create(data)).statusCode).toBe(201);
    await sim.printhub.tick();
    expect(JSON.parse(events.at(-1)!.raw).data.status).toBe('artwork_rejected');
    const stock = body('stock');
    stock.items[0]!.size = 'XXL';
    stock.items[0]!.fit = 'premium';
    stock.items[0]!.colour = 'olive';
    await create(stock);
    await sim.printhub.tick();
    expect(JSON.parse(events.at(-1)!.raw).data.status).toBe('blank_out_of_stock');
  });

  it('retries the same event before advancing and never creates a second job on conflicting retries', async () => {
    setup();
    await create();
    answer = 503;
    now += 3 * DAY;
    await sim.printhub.tick();
    expect(events).toHaveLength(1);
    answer = 200;
    await sim.printhub.tick();
    expect(events[0]!.raw).toBe(events[1]!.raw);
    const changed = body();
    changed.items[0]!.qty = 3;
    expect((await create(changed)).statusCode).toBe(409);
    expect((await create({ ...body('other'), attempt: 2, reprintOf: 'unknown' })).statusCode).toBe(
      409,
    );
  });

  it('keeps the initial webhook retryable while an ambiguous create is retried by the store', async () => {
    setup();
    await create();
    answer = 409;
    await sim.printhub.tick();
    answer = 200;
    now += 2 * DAY;
    await sim.printhub.tick();
    expect(events[0]!.raw).toBe(events[1]!.raw);
    expect(JSON.parse(events.at(-1)!.raw).data.status).toBe('handed_over');
  });

  it('queues the 51st job until the next business day and validates input', async () => {
    setup();
    expect((await create({ ...body(), items: [] })).statusCode).toBe(422);
    for (let i = 0; i < 51; i++) expect((await create(body(`o${i}`))).statusCode).toBe(201);
    now += DAY / 2;
    await sim.printhub.tick();
    expect(events.filter((e) => JSON.parse(e.raw).data.status === 'in_production')).toHaveLength(
      50,
    );
    now += DAY;
    await sim.printhub.tick();
    expect(events.filter((e) => JSON.parse(e.raw).data.status === 'in_production')).toHaveLength(
      51,
    );
  });
});
