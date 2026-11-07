import { afterEach, expect, it } from 'vitest';
import { buildSim, type SimApp } from './app';

let sim: SimApp;
afterEach(async () => {
  await sim?.app.close();
});
const authorization = `Basic ${Buffer.from('founder@example.com:test-only-founder-password').toString('base64')}`;
it('requires founder credentials for controls; validates atomic updates and exposes shared clock', async () => {
  sim = buildSim({ settleEveryMs: 0 });
  expect((await sim.app.inject('/sim/admin')).statusCode).toBe(401);
  expect((await sim.app.inject({ url: '/sim/admin', headers: { authorization } })).body).toContain(
    'Demo controls',
  );
  expect(
    (await sim.app.inject({ method: 'PUT', url: '/sim/clock', payload: { speed: 144 } }))
      .statusCode,
  ).toBe(401);
  const clock = await sim.app.inject({
    method: 'PUT',
    url: '/sim/clock',
    headers: { authorization },
    payload: { speed: 144 },
  });
  expect(clock.statusCode).toBe(200);
  expect((await sim.app.inject('/sim/clock')).json()).toMatchObject({ speed: 144 });
  for (const body of [{ speed: 0 }, { speed: 2 }, { speed: '144' }, { speed: 1, extra: true }]) {
    expect(
      (
        await sim.app.inject({
          method: 'PUT',
          url: '/sim/clock',
          headers: { authorization },
          payload: body,
        })
      ).statusCode,
    ).toBe(422);
  }
  expect(
    (
      await sim.app.inject({
        method: 'PUT',
        url: '/sim/generator',
        headers: { authorization },
        payload: { seed: 123, enabled: true },
      })
    ).statusCode,
  ).toBe(200);
  expect(sim.generator.status()).toMatchObject({ enabled: true, seed: 123 });
  expect(
    (
      await sim.app.inject({
        method: 'PUT',
        url: '/sim/generator',
        headers: { authorization },
        payload: { seed: 42, enabled: false },
      })
    ).statusCode,
  ).toBe(409);
  expect(sim.generator.status()).toMatchObject({ enabled: true, seed: 123 });
  expect(
    (
      await sim.app.inject({
        method: 'PUT',
        url: '/sim/generator',
        headers: { authorization },
        payload: { enabled: false },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await sim.app.inject({
        method: 'PUT',
        url: '/sim/generator',
        headers: { authorization },
        payload: { seed: -1 },
      })
    ).statusCode,
  ).toBe(422);
  expect(
    (
      await sim.app.inject({
        method: 'PUT',
        url: '/sim/clock',
        headers: { authorization, origin: 'https://evil.test' },
        payload: { speed: 1 },
      })
    ).statusCode,
  ).toBe(403);
});
