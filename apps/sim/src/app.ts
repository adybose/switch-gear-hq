import Fastify, { type FastifyInstance } from 'fastify';

// PayMock, PrintHub, ShipFast, generators and the demo clock are added in later tasks.
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', async () => ({ status: 'ok', service: 'sim' }));

  return app;
}
