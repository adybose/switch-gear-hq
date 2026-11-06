// Display data for fits and colours, shared by the storefront and the SVG mockups.

export const FIT_LABELS: Record<string, string> = {
  classic: 'Classic (180 GSM)',
  oversized: 'Oversized (220 GSM)',
  premium: 'Premium (240 GSM)',
};

export const FIT_ORDER = ['classic', 'oversized', 'premium'];

export interface ColourStyle {
  label: string;
  /** Fabric colour. */
  hex: string;
  /** Print colour that reads well on the fabric. */
  ink: string;
}

export const COLOUR_STYLES: Record<string, ColourStyle> = {
  black: { label: 'Black', hex: '#1c1c1c', ink: '#f5f5f4' },
  white: { label: 'White', hex: '#f8f8f6', ink: '#1c1c1c' },
  navy: { label: 'Navy', hex: '#1f2a44', ink: '#f5f5f4' },
  'heather-grey': { label: 'Heather grey', hex: '#a3a6ab', ink: '#1c1c1c' },
  olive: { label: 'Olive', hex: '#556b2f', ink: '#f5f5f4' },
};

export const COLOUR_ORDER = ['black', 'white', 'navy', 'heather-grey', 'olive'];

export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export function colourStyle(colour: string): ColourStyle {
  return COLOUR_STYLES[colour] ?? COLOUR_STYLES.black!;
}

/** Sorts by a fixed order; unknown values go last, alphabetically. */
export function byOrder(order: string[]): (a: string, b: string) => number {
  const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
  return (a, b) => rank(a) - rank(b) || a.localeCompare(b);
}
