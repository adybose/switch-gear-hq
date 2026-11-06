import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHealthServer } from './health';

describe('gatekeeper health server', () => {
  const server = createHealthServer();
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reports health', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'gatekeeper' });
  });

  it('returns 404 for anything else', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
