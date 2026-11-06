import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Repository root (this file is apps/store/src/server/env.ts). */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The test-only local database from .env.example and docker-compose.yml. */
export const LOCAL_DATABASE_URL =
  'postgresql://switchgear:switchgear-test-only@localhost:5432/switchgear';

/** Loads the repo-root .env into process.env if it exists (existing vars win). */
export function loadRootEnv(): void {
  const path = `${REPO_ROOT}.env`;
  if (existsSync(path)) process.loadEnvFile(path);
}
