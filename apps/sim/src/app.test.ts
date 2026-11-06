import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('sim app', () => {
  const app = buildApp();
  afterAll(() => app.close());

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'sim' });
  });
});
