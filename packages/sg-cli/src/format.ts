import { formatRupees } from '@switch-gear/shared/money';

type Json = unknown;

function scalar(key: string, value: Json): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number' && key.endsWith('Paise') && Number.isInteger(value)) {
    return formatRupees(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** `amountPaise` is shown as "amount": the unit is in the value (₹799). */
function label(key: string): string {
  return key.endsWith('Paise') ? key.slice(0, -'Paise'.length) : key;
}

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFlat(value: Json): boolean {
  return value === null || typeof value !== 'object';
}

/** One line per row: the leading id-like field first, then `label value` pairs. */
function row(item: Record<string, Json>): string {
  return Object.entries(item)
    .filter(([, v]) => isFlat(v))
    .slice(0, 7)
    .map(([k, v], i) => (i === 0 ? scalar(k, v) : `${label(k)}=${scalar(k, v)}`))
    .join('  ');
}

/** Short, readable text for an API response body. `--json` bypasses this. */
export function formatBody(body: Json): string {
  if (Array.isArray(body)) {
    if (body.length === 0) return 'Nothing found.';
    return body.map((item) => (isRecord(item) ? row(item) : String(item))).join('\n');
  }
  if (isRecord(body)) {
    const lines = Object.entries(body).map(([k, v]) => {
      if (Array.isArray(v)) {
        const items = v.map((x) => (isRecord(x) ? row(x) : String(x)));
        return items.length === 0
          ? `${label(k)}: -`
          : `${label(k)}:\n${items.map((s) => `  ${s}`).join('\n')}`;
      }
      return `${label(k)}: ${scalar(k, v)}`;
    });
    return lines.join('\n');
  }
  return body === null || body === undefined ? 'Done.' : String(body);
}
