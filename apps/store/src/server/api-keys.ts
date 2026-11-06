import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Department } from '../generated/prisma/enums';

export const DEPARTMENTS = Object.values(Department);

/** `sg_<department>_<random>` (docs/architecture.md). */
export function generateApiKey(department: Department): string {
  return `sg_${department}_${randomBytes(24).toString('base64url')}`;
}

/** SHA-256 is enough here: keys are long random strings, so a slow hash adds nothing. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function envNameFor(department: Department): string {
  return `SG_KEY_${department.toUpperCase()}`;
}

/** Reads `SG_KEY_<DEPT>=<key>` lines. Unknown or malformed lines are ignored. */
export function parseKeysFile(text: string): Partial<Record<Department, string>> {
  const keys: Partial<Record<Department, string>> = {};
  for (const line of text.split('\n')) {
    const match = /^SG_KEY_([A-Z]+)=(sg_[a-z]+_[A-Za-z0-9_-]+)$/.exec(line.trim());
    if (!match) continue;
    const department = match[1]!.toLowerCase() as Department;
    const key = match[2]!;
    if (DEPARTMENTS.includes(department) && key.startsWith(`sg_${department}_`)) {
      keys[department] = key;
    }
  }
  return keys;
}

export function formatKeysFile(keys: Record<Department, string>): string {
  return [
    '# Switch Gear API keys, one per department. Test-only demo keys.',
    '# Written once by `npm run db:seed`; later seeds and demo resets reuse them.',
    '# Git-ignored. Delete this file and reseed to rotate every key.',
    ...DEPARTMENTS.map((d) => `${envNameFor(d)}=${keys[d]}`),
    '',
  ].join('\n');
}

/**
 * Loads the department keys from `path`, generating any that are missing. The file is
 * written only when a key had to be generated, so keys agents already hold stay valid.
 */
export function loadOrCreateKeys(path: string): {
  keys: Record<Department, string>;
  created: Department[];
} {
  const existing = existsSync(path) ? parseKeysFile(readFileSync(path, 'utf8')) : {};
  const created: Department[] = [];
  const keys = {} as Record<Department, string>;
  for (const department of DEPARTMENTS) {
    const key = existing[department];
    if (key) {
      keys[department] = key;
    } else {
      keys[department] = generateApiKey(department);
      created.push(department);
    }
  }
  if (created.length > 0) writeFileSync(path, formatKeysFile(keys), { mode: 0o600 });
  return { keys, created };
}
