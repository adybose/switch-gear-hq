import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads KEY=value lines (optionally quoted, `#` comments, `export ` prefix) from text. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out[match[1]!] = value;
  }
  return out;
}

export interface Config {
  /** API base, always ending in /api/v1 and never in a slash. */
  baseUrl: string;
  apiKey: string;
}

/**
 * SG_API_URL and SG_API_KEY come from the process environment first, then from `.env` in the
 * working folder. SG_STORE_URL (the store's root URL) is accepted as the older name.
 */
export function loadConfig(
  env: Record<string, string | undefined>,
  cwd: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): Config | { error: string } {
  let file: Record<string, string> = {};
  try {
    file = parseDotenv(readFile(join(cwd, '.env')));
  } catch {
    // No .env here: the process environment alone has to be enough.
  }
  const get = (key: string) => env[key] || file[key] || '';
  const apiKey = get('SG_API_KEY');
  const rawUrl = get('SG_API_URL') || get('SG_STORE_URL');
  if (!rawUrl) return { error: 'SG_API_URL is not set. Put it in the .env of this folder.' };
  if (!apiKey) return { error: 'SG_API_KEY is not set. Put it in the .env of this folder.' };
  const root = rawUrl.replace(/\/+$/, '');
  return { baseUrl: /\/api\/v1$/.test(root) ? root : `${root}/api/v1`, apiKey };
}
