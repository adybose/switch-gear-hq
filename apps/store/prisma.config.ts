import { defineConfig } from 'prisma/config';

// Falls back to the test-only local database from .env.example / docker-compose.yml.
const LOCAL_DATABASE_URL = 'postgresql://switchgear:switchgear-test-only@localhost:5432/switchgear';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL },
});
