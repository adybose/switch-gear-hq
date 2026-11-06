import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/v1/health', () => {
  it('reports health', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'store' });
  });
});
