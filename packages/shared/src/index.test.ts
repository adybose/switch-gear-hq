import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTS, DEMO_BANNER } from './index';

describe('shared constants', () => {
  it('uses the ports from docs/architecture.md', () => {
    expect(DEFAULT_PORTS).toEqual({ store: 3000, sim: 4000, gatekeeper: 4100, db: 5432 });
  });

  it('says the store is a demo', () => {
    expect(DEMO_BANNER).toMatch(/^Demo store\./);
  });
});
