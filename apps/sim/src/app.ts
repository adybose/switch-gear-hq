import { DEFAULT_PORTS } from '@switch-gear/shared';
import { webhookSecret } from '@switch-gear/shared/webhooks';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerPrinthub, type Printhub, type PrinthubOptions } from './printhub';
import { registerShipfast, type Shipfast, type ShipfastOptions } from './shipfast';
import { createSimClock } from './clock';
import { registerPaymock, type Paymock, type PaymockOptions } from './paymock';

export interface SimApp {
  app: FastifyInstance;
  paymock: Paymock;
  printhub: Printhub;
  shipfast: Shipfast;
}

// Partners share one business clock. T-15 adds speed controls and the generator.
export function buildSim(
  overrides: Partial<PaymockOptions> = {},
  printOverrides: Partial<PrinthubOptions> = {},
  shipOverrides: Partial<ShipfastOptions> = {},
): SimApp {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', async () => ({ status: 'ok', service: 'sim' }));

  const clock = overrides.clock ?? createSimClock();
  app.get('/sim/clock', async () => ({ now: clock.now().toISOString(), speed: clock.speed() }));
  const paymock = registerPaymock(app, {
    clock,
    storeUrl: process.env.STORE_URL || `http://localhost:${DEFAULT_PORTS.store}`,
    secret: webhookSecret('paymock'),
    settleEveryMs: 5000,
    ...overrides,
  });

  const printhub = registerPrinthub(app, {
    clock,
    storeUrl:
      overrides.storeUrl ?? process.env.STORE_URL ?? `http://localhost:${DEFAULT_PORTS.store}`,
    secret: webhookSecret('printhub'),
    fetch: overrides.fetch,
    tickEveryMs: 1000,
    ...printOverrides,
  });
  const shipfast = registerShipfast(app, {
    clock,
    storeUrl:
      overrides.storeUrl ?? process.env.STORE_URL ?? `http://localhost:${DEFAULT_PORTS.store}`,
    secret: webhookSecret('shipfast'),
    fetch: overrides.fetch,
    tickEveryMs: 1000,
    ...shipOverrides,
  });
  return { app, paymock, printhub, shipfast };
}

export function buildApp(overrides: Partial<PaymockOptions> = {}): FastifyInstance {
  return buildSim(overrides).app;
}
