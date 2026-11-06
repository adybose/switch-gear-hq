// Checkout pricing rules (docs/spec.md §2). Pure: callers look up unit prices and the
// discount code themselves. Prices include GST; tax is worked out of them, not added.

import {
  gstRateForPiece,
  gstTypeForState,
  percentOf,
  splitInclusive,
  type GstRate,
  type GstType,
} from './money';

export const BUNDLE_MIN_ITEMS = 3;
export const BUNDLE_PERCENT = 10;
export const FREE_SHIPPING_FROM_PAISE = 99900;
export const SHIPPING_FEE_PAISE = 7900;

export interface PricingLine {
  sku: string;
  /** GST-inclusive catalogue price per piece. */
  unitPricePaise: number;
  qty: number;
}

export interface PricingInput {
  lines: PricingLine[];
  /** Percent off from a valid discount code, if one was entered. */
  codePercent?: number;
  /** Customer's state, for CGST+SGST vs IGST. */
  state: string;
}

export interface PricedLine extends PricingLine {
  linePaise: number;
  /** This line's share of the order discount. */
  discountPaise: number;
  gstRate: GstRate;
}

export interface Pricing {
  lines: PricedLine[];
  itemCount: number;
  subtotalPaise: number;
  /** Which discount applied: the bundle and a code don't stack; the bigger one wins. */
  discountSource: 'bundle' | 'code' | null;
  discountPercent: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  /** GST included in the total. */
  gstType: GstType;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/** Splits `amount` across `weights` in proportion, largest remainder first; sums exactly. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / total);
  const shares = exact.map(Math.floor);
  let left = amount - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

export function priceOrder({ lines, codePercent, state }: PricingInput): Pricing {
  if (lines.length === 0) throw new RangeError('an order needs at least one line');
  for (const l of lines) {
    if (!Number.isSafeInteger(l.unitPricePaise) || l.unitPricePaise < 0) {
      throw new RangeError(`${l.sku}: unitPricePaise must be non-negative integer paise`);
    }
    if (!Number.isSafeInteger(l.qty) || l.qty < 1) {
      throw new RangeError(`${l.sku}: qty must be a positive integer`);
    }
  }
  if (codePercent !== undefined && !(codePercent > 0 && codePercent <= 100)) {
    throw new RangeError('codePercent must be between 0 and 100');
  }

  const itemCount = lines.reduce((n, l) => n + l.qty, 0);
  const lineTotals = lines.map((l) => l.unitPricePaise * l.qty);
  const subtotalPaise = lineTotals.reduce((a, b) => a + b, 0);

  const bundlePercent = itemCount >= BUNDLE_MIN_ITEMS ? BUNDLE_PERCENT : 0;
  const code = codePercent ?? 0;
  const discountSource =
    code === 0 && bundlePercent === 0 ? null : code > bundlePercent ? 'code' : 'bundle';
  const discountPercent = Math.max(code, bundlePercent);
  const discountPaise = percentOf(subtotalPaise, discountPercent);
  const lineDiscounts = allocate(discountPaise, lineTotals);

  const goodsPaise = subtotalPaise - discountPaise;
  const shippingPaise = goodsPaise >= FREE_SHIPPING_FROM_PAISE ? 0 : SHIPPING_FEE_PAISE;

  const priced: PricedLine[] = lines.map((l, i) => {
    const net = lineTotals[i]! - lineDiscounts[i]!;
    return {
      ...l,
      linePaise: lineTotals[i]!,
      discountPaise: lineDiscounts[i]!,
      gstRate: gstRateForPiece(Math.round(net / l.qty)),
    };
  });

  // Group GST-inclusive amounts by rate; shipping takes the highest rate in the cart.
  const grossByRate = new Map<GstRate, number>();
  priced.forEach((l) => {
    grossByRate.set(l.gstRate, (grossByRate.get(l.gstRate) ?? 0) + l.linePaise - l.discountPaise);
  });
  const shippingRate: GstRate = priced.some((l) => l.gstRate === 18) ? 18 : 5;
  grossByRate.set(shippingRate, (grossByRate.get(shippingRate) ?? 0) + shippingPaise);

  const gstType = gstTypeForState(state);
  let taxablePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  for (const [rate, gross] of grossByRate) {
    const split = splitInclusive(gross, rate);
    taxablePaise += split.taxablePaise;
    if (gstType === 'inter') {
      igstPaise += split.taxPaise;
    } else {
      const half = Math.floor(split.taxPaise / 2);
      cgstPaise += half;
      sgstPaise += split.taxPaise - half;
    }
  }

  return {
    lines: priced,
    itemCount,
    subtotalPaise,
    discountSource,
    discountPercent,
    discountPaise,
    shippingPaise,
    totalPaise: goodsPaise + shippingPaise,
    gstType,
    taxablePaise,
    taxPaise: cgstPaise + sgstPaise + igstPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
  };
}
