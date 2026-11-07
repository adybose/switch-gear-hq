import { signWebhook, SIGNATURE_HEADER, verifyWebhook } from '@switch-gear/shared/webhooks';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSim, type SimApp } from './app';

const DAY = 86_400_000;
const secret = 'test_shipfast_secret';
const input = (pincode = '560034', orderRef = 'order1') => ({
  orderRef,
  orderNumber: 'ORD-1001',
  sequence: 1,
  weightGrams: 200,
  pickup: {
    name: 'PrintHub',
    address: '1 Demo Warehouse',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    phone: '9876543210',
  },
  drop: {
    name: 'Demo',
    address: '1 Test Road',
    city: 'Demo City',
    state: 'Demo State',
    pincode,
    phone: '9876543210',
  },
});

describe('ShipFast courier', () => {
  let sim: SimApp;
  let now: number;
  let answer: number;
  let events: { raw: string; signature: string }[];
  function setup(draws: number[] = []) {
    now = Date.parse('2026-11-07T10:00:00Z');
    answer = 200;
    events = [];
    sim = buildSim(
      { clock: { now: () => new Date(now), speed: () => 144 }, settleEveryMs: 0 },
      { tickEveryMs: 0 },
      {
        tickEveryMs: 0,
        random: () => draws.shift() ?? 0.5,
        fetch: (async (_url, init) => {
          events.push({
            raw: String(init?.body),
            signature: (init?.headers as Record<string, string>)[SIGNATURE_HEADER]!,
          });
          return new Response(answer === 409 ? '{"error":"unknown_shipment"}' : '{}', {
            status: answer,
          });
        }) as typeof fetch,
      },
    );
  }
  const create = (body: unknown = input(), signed = true) => {
    const raw = JSON.stringify(body);
    return sim.app.inject({
      method: 'POST',
      url: '/shipfast/v1/shipments',
      payload: raw,
      headers: {
        'content-type': 'application/json',
        ...(signed ? { [SIGNATURE_HEADER]: signWebhook(secret, raw) } : {}),
      },
    });
  };
  const payloads = () => events.map((e) => JSON.parse(e.raw));
  afterEach(async () => {
    await sim?.app.close();
  });

  it.each([
    ['560034', 'same_city', 1, 5000],
    ['600001', 'same_zone', 3, 6500],
    ['110001', 'national', 5, 8500],
  ])('prices %s and delivers at its zone transit deadline', async (pin, zone, days, cost) => {
    setup();
    const res = await create(input(String(pin)));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'pickup_scheduled',
      zone,
      costPaise: cost,
      attempts: 0,
    });
    now += Number(days) * DAY - 1;
    await sim.shipfast.tick();
    expect(payloads().at(-1).data.status).toBe('out_for_delivery');
    now++;
    await sim.shipfast.tick();
    expect(payloads().map((e) => e.data.status)).toEqual([
      'pickup_scheduled',
      'picked_up',
      'in_transit',
      'out_for_delivery',
      'delivered',
    ]);
    expect(payloads().at(-1).data).toMatchObject({ attempts: 1, costPaise: cost });
    expect(events.every((e) => verifyWebhook(secret, e.raw, e.signature))).toBe(true);
  });

  it('requires signed valid serviceable requests and reuses identical booking requests', async () => {
    setup();
    expect((await create(input(), false)).statusCode).toBe(401);
    expect((await create({ ...input(), weightGrams: 0 })).statusCode).toBe(422);
    expect((await create(input('194101'))).statusCode).toBe(422);
    const first = (await create()).json();
    expect((await create()).json().awb).toBe(first.awb);
    expect((await create({ ...input(), weightGrams: 300 })).statusCode).toBe(409);
    expect((await create({ ...input(), sequence: 2, reshipOfAwb: 'unknown' })).statusCode).toBe(
      409,
    );
  });

  it('allows two retries then returns to origin, charging the outbound rate once more', async () => {
    setup([0.5, 0.01, 0.01, 0.01]);
    const original = (await create()).json();
    now += 4 * DAY;
    await sim.shipfast.tick();
    expect(payloads().map((e) => e.data.status)).toEqual([
      'pickup_scheduled',
      'picked_up',
      'in_transit',
      'out_for_delivery',
      'delivery_failed',
      'out_for_delivery',
      'delivery_failed',
      'out_for_delivery',
      'delivery_failed',
      'returned_to_origin',
    ]);
    expect(
      payloads()
        .filter((e) => e.data.status === 'delivery_failed')
        .map((e) => e.data.attempts),
    ).toEqual([1, 2, 3]);
    expect(payloads().at(-1).data.costPaise).toBe(10000);
    const reship = await create({ ...input(), sequence: 2, reshipOfAwb: original.awb });
    expect(reship.statusCode).toBe(201);
    expect(reship.json().costPaise).toBe(5000);
    expect(reship.json().awb).not.toBe(original.awb);
  });

  it('can deliver on a retry without charging RTO', async () => {
    setup([0.5, 0.01, 0.5]);
    await create();
    now += 2 * DAY;
    await sim.shipfast.tick();
    expect(payloads().filter((e) => e.data.status === 'delivery_failed')).toHaveLength(1);
    expect(payloads().at(-1).data).toMatchObject({
      status: 'delivered',
      attempts: 2,
      costPaise: 5000,
    });
  });

  it.each([
    [0.0049, 'lost'],
    [0.005, 'delivered'],
  ])('samples loss at 0.5 percent (%s)', async (draw, status) => {
    setup([Number(draw), 0.5]);
    await create();
    now += 5 * DAY;
    await sim.shipfast.tick();
    expect(payloads().at(-1).data.status).toBe(status);
    if (status === 'lost')
      expect(payloads().at(-1).data).toMatchObject({
        attempts: 0,
        costPaise: 5000,
        reason: 'lost',
      });
  });

  it('retries stable signed callback bytes before advancing, including a lost booking response', async () => {
    setup();
    await create();
    answer = 503;
    now += DAY;
    await sim.shipfast.tick();
    expect(events).toHaveLength(1);
    answer = 409;
    await sim.shipfast.tick();
    answer = 200;
    await sim.shipfast.tick();
    expect(events[0]!.raw).toBe(events[1]!.raw);
    expect(events[1]!.raw).toBe(events[2]!.raw);
    expect(payloads().at(-1).data.status).toBe('delivered');
  });
});
