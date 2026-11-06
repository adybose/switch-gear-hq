import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Pick up DATABASE_URL etc. from a local .env so database tests run when Postgres is up.
// Without it (e.g. a fresh clone) those tests are skipped; CI sets DATABASE_URL itself.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    // Database tests share one Postgres and the demo reset truncates it: run files one by one.
    fileParallelism: false,
  },
});
