import { describe, expect, it } from 'vitest';
import type { Department, PrismaClient } from '../generated/prisma/client';
import { DEPARTMENTS, generateApiKey, hashApiKey } from './api-keys';
import { authorize } from './auth';
import type { Scope } from './scopes';

const keys = Object.fromEntries(DEPARTMENTS.map((d) => [d, generateApiKey(d)])) as Record<
  Department,
  string
>;
const byHash = new Map(DEPARTMENTS.map((d) => [hashApiKey(keys[d]), d]));
const db = {
  apiKey: {
    findUnique: async ({ where }: { where: { hash: string } }) => {
      const department = byHash.get(where.hash);
      return department ? { department, revokedAt: null } : null;
    },
  },
} as unknown as PrismaClient;

const call = (key: string | null, scope: Scope) =>
  authorize(
    db,
    new Request('http://localhost/x', { headers: key ? { authorization: `Bearer ${key}` } : {} }),
    scope,
  );

describe('authorize()', () => {
  it('returns the department when the key has the scope', async () => {
    expect(await call(keys.finance, 'refunds:write')).toEqual({ department: 'finance' });
  });

  it.each([
    ['fulfilment', 'refunds:write'],
    ['finance', 'print_jobs:write'],
    ['marketing', 'ledger:read'],
    ['support', 'refunds:write'],
    ['engineering', 'orders:read'],
    ['hq', 'refunds:write'],
    ['founder', 'print_jobs:write'],
  ] as const)('%s key is refused %s with 403', async (department, scope) => {
    const result = await call(keys[department], scope);
    expect('response' in result).toBe(true);
    if (!('response' in result)) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toMatchObject({ error: 'forbidden' });
  });

  it('answers 401 for a missing or unknown key before checking scope', async () => {
    for (const key of [null, 'sg_finance_notarealkey']) {
      const result = await call(key, 'refunds:write');
      expect('response' in result && result.response.status).toBe(401);
    }
  });
});
