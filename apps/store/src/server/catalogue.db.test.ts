import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getArtworkSubject, getProduct, listCollections, listProducts } from './catalogue';
import { createDb, type Db } from './db';
import { resetDemo } from './seed/seed';

// Needs a migrated Postgres (DATABASE_URL). Resets the database to the demo seed state.
describe.skipIf(!process.env.DATABASE_URL)('storefront catalogue (database)', () => {
  let db: Db;
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-catalogue-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };

  beforeAll(async () => {
    db = createDb();
    await resetDemo(db, options);
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('lists the four collections in catalogue order', async () => {
    expect(await listCollections(db)).toEqual([
      { slug: 'namma-bengaluru', name: 'Namma Bengaluru', productCount: 3 },
      { slug: 'dev-humour', name: 'Dev Humour', productCount: 4 },
      { slug: 'kaapi-culture', name: 'Kaapi Culture', productCount: 3 },
      { slug: 'basics', name: 'Basics', productCount: 2 },
    ]);
  });

  it('lists products with their lowest price, optionally by collection', async () => {
    const all = await listProducts(db);
    expect(all).toHaveLength(12);
    expect(all.every((p) => p.fromPricePaise === 59900)).toBe(true);
    const kaapi = await listProducts(db, 'kaapi-culture');
    expect(kaapi.map((p) => p.slug)).toEqual([
      'kaapi-break',
      'powered-by-filter-coffee',
      'tumbler-and-dabara',
    ]);
  });

  it('returns a product with sorted active variants', async () => {
    const product = await getProduct(db, 'silk-board-survivor');
    expect(product?.collectionName).toBe('Namma Bengaluru');
    expect(product?.variants).toHaveLength(90);
    expect(product?.variants[0]).toEqual({
      sku: 'SG-SILKBOARD-CLS-BLK-XS',
      fit: 'classic',
      colour: 'black',
      size: 'XS',
      pricePaise: 59900,
    });
  });

  it('hides drafts, inactive variants and unknown slugs', async () => {
    await db.product.update({ where: { slug: 'off-by-one' }, data: { status: 'draft' } });
    await db.variant.update({ where: { sku: 'SG-SLEEP404-PRM-OLV-XXL' }, data: { active: false } });

    expect(await getProduct(db, 'off-by-one')).toBeNull();
    expect(await getArtworkSubject(db, 'off-by-one')).toBeNull();
    expect((await listProducts(db)).map((p) => p.slug)).not.toContain('off-by-one');
    expect((await getProduct(db, 'sleep-not-found'))?.variants).toHaveLength(89);
    expect(await getProduct(db, 'no-such-tee')).toBeNull();
  });

  it('describes mockup subjects, with a small logo for basics', async () => {
    expect(await getArtworkSubject(db, 'switch-gear-logo')).toEqual({
      name: 'Switch Gear Logo Tee',
      style: 'small-logo',
    });
    expect((await getArtworkSubject(db, 'kaapi-break'))?.style).toBe('statement');
  });
});
