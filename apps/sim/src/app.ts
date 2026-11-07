import { createGenerator, type OrderGenerator } from './generator';
import { registerControls } from './controls';
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
  generator: OrderGenerator;
}

// Partners and generated orders share one controllable business clock.
export function buildSim(
  overrides: Partial<PaymockOptions> = {},
  printOverrides: Partial<PrinthubOptions> = {},
  shipOverrides: Partial<ShipfastOptions> = {},
  generatorOptions: { seed?: number; tickEveryMs?: number } = {},
): SimApp {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', async () => ({ status: 'ok', service: 'sim' }));

  const clock = overrides.clock ?? createSimClock();
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
  const generator = createGenerator({
    clock,
    paymock,
    storeUrl:
      overrides.storeUrl ?? process.env.STORE_URL ?? `http://localhost:${DEFAULT_PORTS.store}`,
    fetch: overrides.fetch,
    seed: generatorOptions.seed ?? Number(process.env.SIM_GENERATOR_SEED ?? 42),
  });
  if (process.env.SIM_GENERATOR_ENABLED === 'true') generator.configure({ enabled: true });
  registerControls(app, clock, generator);
  const tickEveryMs = generatorOptions.tickEveryMs ?? 1000;
  const timer = tickEveryMs
    ? setInterval(() => {
        void generator.tick();
        void paymock
          .resolveDuePending()
          .catch((error) => app.log.error(error, 'pending payment tick failed'));
      }, tickEveryMs)
    : undefined;
  timer?.unref();
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
  return { app, paymock, printhub, shipfast, generator };
}

export function buildApp(overrides: Partial<PaymockOptions> = {}): FastifyInstance {
  return buildSim(overrides).app;
}
