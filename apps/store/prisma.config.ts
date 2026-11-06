import { defineConfig } from 'prisma/config';
import { LOCAL_DATABASE_URL, loadRootEnv } from './src/server/env';

// Uses DATABASE_URL from the shell or the repo-root .env, else the test-only local database.
loadRootEnv();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL },
});
