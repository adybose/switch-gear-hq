import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { DEPARTMENTS, hashApiKey, loadOrCreateKeys } from '../api-keys';
import { hashPassword } from '../password';
import { artworkUrlFor, DESIGNS, variantsFor } from './catalogue';
import { FEATURE_FLAGS, FOUNDER_LOGIN_KEY, SETTINGS } from './settings';

type Db = PrismaClient | Prisma.TransactionClient;

export interface SeedOptions {
  /** Where department API keys are read from / written to (`.env.local.keys`). */
  keysPath: string;
  founderEmail: string;
  founderPassword: string;
}

export interface SeedResult {
  products: number;
  variants: number;
  /** Departments whose API key was newly generated (and written to keysPath). */
  keysCreated: string[];
}

/**
 * Adds the demo starting data: catalogue, approval limits and budgets, feature flags,
 * founder login and one API key per department. Only missing rows are added, so running
 * it on a live database never overwrites changes; `resetDemo()` wipes first. The one
 * exception is API keys: any key not in the keys file is revoked.
 */
export async function seed(db: Db, options: SeedOptions): Promise<SeedResult> {
  await db.product.createMany({
    data: DESIGNS.map((design) => ({
      slug: design.slug,
      name: design.name,
      collection: design.collection,
      description: design.description,
      artworkUrl: artworkUrlFor(design),
      status: 'published' as const,
    })),
    skipDuplicates: true,
  });

  const products = await db.product.findMany({
    where: { slug: { in: DESIGNS.map((d) => d.slug) } },
    select: { id: true, slug: true },
  });
  const productId = new Map(products.map((p) => [p.slug, p.id]));
  const variants = DESIGNS.flatMap((design) =>
    variantsFor(design).map((variant) => ({ ...variant, productId: productId.get(design.slug)! })),
  );
  await db.variant.createMany({ data: variants, skipDuplicates: true });

  await db.setting.createMany({
    data: [
      ...Object.entries(SETTINGS).map(([key, value]) => ({ key, value })),
      {
        key: FOUNDER_LOGIN_KEY,
        value: {
          email: options.founderEmail,
          passwordHash: await hashPassword(options.founderPassword),
        },
      },
    ],
    skipDuplicates: true,
  });

  await db.featureFlag.createMany({
    data: Object.entries(FEATURE_FLAGS).map(([key, enabled]) => ({ key, enabled })),
    skipDuplicates: true,
  });

  // The keys file is the source of truth: its keys are active, every other key is revoked.
  // Deleting the file and reseeding therefore rotates every key.
  const { keys, created } = loadOrCreateKeys(options.keysPath);
  const hashes = DEPARTMENTS.map((department) => hashApiKey(keys[department]));
  await db.apiKey.updateMany({
    where: { hash: { notIn: hashes }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await db.apiKey.createMany({
    data: DEPARTMENTS.map((department, i) => ({ department, hash: hashes[i]! })),
    skipDuplicates: true,
  });

  return { products: DESIGNS.length, variants: variants.length, keysCreated: created };
}

/** Empties every table (except Prisma's migration history) and resets ID sequences. */
export async function wipe(db: Db): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename.replaceAll('"', '""')}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * `npm run demo:reset`: wipe, then seed, in one transaction so a failure leaves the
 * database as it was. Gives the same state every time.
 */
export async function resetDemo(db: PrismaClient, options: SeedOptions): Promise<SeedResult> {
  return db.$transaction(
    async (tx) => {
      await wipe(tx);
      return seed(tx, options);
    },
    { timeout: 60_000 },
  );
}
