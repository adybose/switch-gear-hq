// `npm run db:seed` (add missing seed rows) and `npm run demo:reset` (wipe + seed).
// Usage: tsx scripts/seed.ts [--reset]
import { createDb } from '../src/server/db';
import { LOCAL_DATABASE_URL, loadRootEnv, REPO_ROOT } from '../src/server/env';
import { resetDemo, seed, type SeedOptions } from '../src/server/seed/seed';

loadRootEnv();

const reset = process.argv.includes('--reset');
const options: SeedOptions = {
  keysPath: `${REPO_ROOT}.env.local.keys`,
  founderEmail: process.env.FOUNDER_EMAIL ?? 'founder@example.com',
  founderPassword: process.env.FOUNDER_PASSWORD ?? 'test-only-founder-password',
};

const db = createDb(process.env.DATABASE_URL ?? LOCAL_DATABASE_URL);
try {
  const result = reset ? await resetDemo(db, options) : await seed(db, options);
  console.log(
    `${reset ? 'Demo reset' : 'Seed'} done: ${result.products} products, ${result.variants} variants.`,
  );
  console.log(
    result.keysCreated.length > 0
      ? `New API keys for ${result.keysCreated.join(', ')} written to .env.local.keys`
      : 'API keys reused from .env.local.keys',
  );
} finally {
  await db.$disconnect();
}
