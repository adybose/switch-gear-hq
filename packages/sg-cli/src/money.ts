/**
 * Rupees typed by a person ("799", "799.5", "1,299.50") to integer paise, using string
 * arithmetic so no float ever touches money. Returns null for anything else.
 */
export function parseRupees(text: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(
    text.trim().replace(/^₹/, '').replaceAll(',', ''),
  );
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return paise > 0 ? paise : null;
}
