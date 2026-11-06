import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export type Db = PrismaClient;

export function createDb(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One client per process; reused across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export function getDb(): PrismaClient {
  globalForDb.db ??= createDb();
  return globalForDb.db;
}
