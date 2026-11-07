import { DEFAULT_PORTS } from '@switch-gear/shared';
import { webhookSecret } from '@switch-gear/shared/webhooks';
import Fastify, { type FastifyInstance } from 'fastify';
import { createSimClock } from './clock';
import { registerPaymock, type Paymock, type PaymockOptions } from './paymock';

export interface SimApp {
  app: FastifyInstance;
  paymock: Paymock;
}

// PrintHub, ShipFast, generators and the demo clock are added in later tasks.
export function buildSim(overrides: Partial<PaymockOptions> = {}): SimApp {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', async () => ({ status: 'ok', service: 'sim' }));

  const paymock = registerPaymock(app, {
    clock: createSimClock(),
    storeUrl: process.env.STORE_URL || `http://localhost:${DEFAULT_PORTS.store}`,
    secret: webhookSecret('paymock'),
    settleEveryMs: 5000,
    ...overrides,
  });

  return { app, paymock };
}

export function buildApp(overrides: Partial<PaymockOptions> = {}): FastifyInstance {
  return buildSim(overrides).app;
}
