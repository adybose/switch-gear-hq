// Cart state, kept in the browser. Prices here are for display only: checkout (T-06)
// re-prices every line on the server from the SKU.

export interface CartLine {
  sku: string;
  slug: string;
  name: string;
  fit: string;
  colour: string;
  size: string;
  unitPricePaise: number;
  qty: number;
}

export type Cart = CartLine[];

export const MAX_QTY_PER_LINE = 10;

function clampQty(qty: number): number {
  return Math.min(MAX_QTY_PER_LINE, Math.max(0, Math.floor(qty)));
}

export function addLine(cart: Cart, line: Omit<CartLine, 'qty'>, qty = 1): Cart {
  const existing = cart.find((l) => l.sku === line.sku);
  if (existing) return setQty(cart, line.sku, existing.qty + qty);
  const clamped = clampQty(qty);
  return clamped > 0 ? [...cart, { ...line, qty: clamped }] : cart;
}

/** Sets a line's quantity (capped at MAX_QTY_PER_LINE); 0 removes it. */
export function setQty(cart: Cart, sku: string, qty: number): Cart {
  const clamped = clampQty(qty);
  if (clamped === 0) return removeLine(cart, sku);
  return cart.map((l) => (l.sku === sku ? { ...l, qty: clamped } : l));
}

export function removeLine(cart: Cart, sku: string): Cart {
  return cart.filter((l) => l.sku !== sku);
}

export function itemCount(cart: Cart): number {
  return cart.reduce((n, l) => n + l.qty, 0);
}

export function subtotalPaise(cart: Cart): number {
  return cart.reduce((sum, l) => sum + l.unitPricePaise * l.qty, 0);
}

function isCartLine(value: unknown): value is CartLine {
  if (value === null || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  return (
    ['sku', 'slug', 'name', 'fit', 'colour', 'size'].every((k) => typeof l[k] === 'string') &&
    Number.isSafeInteger(l.unitPricePaise) &&
    (l.unitPricePaise as number) >= 0 &&
    Number.isSafeInteger(l.qty) &&
    (l.qty as number) > 0 &&
    (l.qty as number) <= MAX_QTY_PER_LINE
  );
}

/** Reads a stored cart; anything malformed is dropped rather than trusted. */
export function parseCart(raw: string | null): Cart {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isCartLine) : [];
  } catch {
    return [];
  }
}
