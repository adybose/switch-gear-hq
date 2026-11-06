import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashApiKey, parseKeysFile } from '../api-keys';
import { createDb, type Db } from '../db';
import { verifyPassword } from '../password';
import { resetDemo, seed, type SeedOptions } from './seed';
import { FOUNDER_LOGIN_KEY, SETTINGS } from './settings';

// Needs a migrated Postgres (DATABASE_URL). This test resets the database to the demo
// starting state, as `npm run demo:reset` does.
describe.skipIf(!process.env.DATABASE_URL)('seed and demo reset (database)', () => {
  let db: Db;
  const options: SeedOptions = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-seed-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };

  /** Everything the seed controls, without generated ids, timestamps or salted hashes. */
  async function snapshot() {
    const [products, variants, settings, flags, apiKeys, customers, events] = await Promise.all([
      db.product.findMany({
        orderBy: { slug: 'asc' },
        select: {
          slug: true,
          name: true,
          collection: true,
          description: true,
          artworkUrl: true,
          status: true,
        },
      }),
      db.variant.findMany({
        orderBy: { sku: 'asc' },
        select: {
          sku: true,
          fit: true,
          colour: true,
          size: true,
          pricePaise: true,
          active: true,
          product: { select: { slug: true } },
        },
      }),
      db.setting.findMany({ orderBy: { key: 'asc' } }),
      db.featureFlag.findMany({ orderBy: { key: 'asc' } }),
      db.apiKey.findMany({
        orderBy: { department: 'asc' },
        select: { department: true, hash: true, revokedAt: true },
      }),
      db.customer.count(),
      db.event.count(),
    ]);
    const stableSettings = settings.map((s) =>
      s.key === FOUNDER_LOGIN_KEY ? { key: s.key, email: (s.value as { email: string }).email } : s,
    );
    return { products, variants, settings: stableSettings, flags, apiKeys, customers, events };
  }

  beforeAll(() => {
    db = createDb();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('creates the demo starting state', async () => {
    await db.customer.create({
      data: {
        name: 'Leftover Customer',
        email: 'leftover@example.com',
        phone: '9000000000',
        address: '1 Test Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
    });

    await resetDemo(db, options);

    expect(await db.customer.count()).toBe(0);
    expect(await db.product.count({ where: { status: 'published' } })).toBe(12);
    const collections = await db.product.groupBy({ by: ['collection'], _count: true });
    expect(collections).toHaveLength(4);
    expect(await db.variant.count()).toBe(12 * 90);
    expect(
      await db.variant.findUnique({
        where: { sku: 'SG-SILKBOARD-OVR-BLK-L' },
        select: { pricePaise: true },
      }),
    ).toEqual({ pricePaise: 79900 });

    for (const [key, value] of Object.entries(SETTINGS)) {
      expect(await db.setting.findUnique({ where: { key } })).toEqual({ key, value });
    }
    expect(await db.featureFlag.count()).toBeGreaterThan(0);

    const login = await db.setting.findUniqueOrThrow({ where: { key: FOUNDER_LOGIN_KEY } });
    const { email, passwordHash } = login.value as { email: string; passwordHash: string };
    expect(email).toBe('founder@example.com');
    expect(await verifyPassword('test-only-founder-password', passwordHash)).toBe(true);

    const fileKeys = parseKeysFile(readFileSync(options.keysPath, 'utf8'));
    const stored = await db.apiKey.findMany();
    expect(stored).toHaveLength(7);
    for (const key of stored) {
      expect(key.hash).toBe(hashApiKey(fileKeys[key.department]!));
    }
  });

  it('gives the same state on every reset, keeping the same API keys', async () => {
    await resetDemo(db, options);
    const first = await snapshot();
    const keysFile = readFileSync(options.keysPath, 'utf8');

    await db.featureFlag.update({ where: { key: 'payments.cod' }, data: { enabled: true } });
    await resetDemo(db, options);

    expect(await snapshot()).toEqual(first);
    expect(readFileSync(options.keysPath, 'utf8')).toBe(keysFile);
  });

  it('db:seed adds only missing rows and keeps changes', async () => {
    await resetDemo(db, options);
    await db.featureFlag.update({ where: { key: 'payments.cod' }, data: { enabled: true } });
    await db.variant.delete({ where: { sku: 'SG-LOGO-CLS-WHT-M' } });

    await seed(db, options);

    expect(await db.variant.count()).toBe(12 * 90);
    expect(await db.featureFlag.findUnique({ where: { key: 'payments.cod' } })).toEqual({
      key: 'payments.cod',
      enabled: true,
    });
    await resetDemo(db, options);
  });
});
