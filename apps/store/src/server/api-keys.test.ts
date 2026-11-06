import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEPARTMENTS,
  formatKeysFile,
  generateApiKey,
  hashApiKey,
  loadOrCreateKeys,
  parseKeysFile,
} from './api-keys';

const tempKeysPath = () => join(mkdtempSync(join(tmpdir(), 'sg-keys-')), '.env.local.keys');

describe('API keys', () => {
  it('generates sg_<department>_<random> keys', () => {
    const key = generateApiKey('finance');
    expect(key).toMatch(/^sg_finance_[A-Za-z0-9_-]{32}$/);
    expect(generateApiKey('finance')).not.toBe(key);
  });

  it('hashes deterministically without keeping the key', () => {
    const key = generateApiKey('support');
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toContain(key);
  });

  it('round-trips the keys file', () => {
    const keys = Object.fromEntries(DEPARTMENTS.map((d) => [d, generateApiKey(d)])) as Record<
      (typeof DEPARTMENTS)[number],
      string
    >;
    expect(parseKeysFile(formatKeysFile(keys))).toEqual(keys);
  });

  it('ignores a key filed under the wrong department', () => {
    expect(parseKeysFile(`SG_KEY_FINANCE=${generateApiKey('support')}\n`)).toEqual({});
  });

  it('writes the file once, then reuses it', () => {
    const path = tempKeysPath();
    const first = loadOrCreateKeys(path);
    expect(first.created).toEqual(DEPARTMENTS);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const written = readFileSync(path, 'utf8');

    const second = loadOrCreateKeys(path);
    expect(second.created).toEqual([]);
    expect(second.keys).toEqual(first.keys);
    expect(readFileSync(path, 'utf8')).toBe(written);
  });

  it('only generates the departments missing from the file', () => {
    const path = tempKeysPath();
    const finance = generateApiKey('finance');
    writeFileSync(path, `SG_KEY_FINANCE=${finance}\n`);
    const { keys, created } = loadOrCreateKeys(path);
    expect(keys.finance).toBe(finance);
    expect(created).toEqual(DEPARTMENTS.filter((d) => d !== 'finance'));
  });
});
