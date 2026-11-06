// Garment measurements in inches, laid flat. Oversized is cut wider and longer.

export interface SizeRow {
  size: string;
  chestIn: number;
  lengthIn: number;
}

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function rows(chestStart: number, lengthStart: number): SizeRow[] {
  return SIZES.map((size, i) => ({ size, chestIn: chestStart + 2 * i, lengthIn: lengthStart + i }));
}

export const SIZE_CHART: Record<string, SizeRow[]> = {
  classic: rows(36, 26),
  oversized: rows(40, 27),
  premium: rows(36, 26),
};

export function sizeChartFor(fit: string): SizeRow[] {
  return SIZE_CHART[fit] ?? SIZE_CHART.classic!;
}
