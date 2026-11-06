// Money is always an integer number of paise. Format to rupees only at the UI edge.
// GST rules follow docs/spec.md §6 (simulation, not tax advice).

/** Throws unless `value` is a safe integer number of paise. */
export function assertPaise(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of paise, got ${value}`);
  }
  return value;
}

/** Whole or two-decimal rupees to paise: `rupeesToPaise(599)` → 59900. */
export function rupeesToPaise(rupees: number): number {
  const paise = Math.round(rupees * 100);
  if (!Number.isSafeInteger(paise) || Math.abs(paise - rupees * 100) > 1e-6) {
    throw new RangeError(`rupees must have at most two decimals, got ${rupees}`);
  }
  return paise;
}

export function sumPaise(...amounts: number[]): number {
  return amounts.reduce((total, amount) => total + assertPaise(amount), 0);
}

/** `percent`% of an amount, rounded to the nearest paisa (halves away from zero). */
export function percentOf(amountPaise: number, percent: number): number {
  assertPaise(amountPaise);
  const exact = (amountPaise * percent) / 100;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const rupeesWithPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats paise as rupees with Indian digit grouping: 129900 → "₹1,299",
 * 10000000 → "₹1,00,000", 129950 → "₹1,299.50", -5000 → "-₹50".
 */
export function formatRupees(amountPaise: number): string {
  assertPaise(amountPaise);
  const format = amountPaise % 100 === 0 ? wholeRupees : rupeesWithPaise;
  return format.format(amountPaise / 100);
}

// ---------- GST ----------

export type GstRate = 5 | 18;
export type GstType = 'intra' | 'inter';

/** Tees up to ₹2,500 a piece (before GST) are taxed at 5%, above at 18%. */
export const GST_LOW_RATE_LIMIT_PAISE = 250000;

/**
 * GST rate for one tee, from its GST-inclusive selling price per piece (after discounts).
 * The ₹2,500 limit applies to the price before GST, worked out at the 5% rate.
 */
export function gstRateForPiece(unitPriceInclPaise: number): GstRate {
  return splitInclusive(unitPriceInclPaise, 5).taxablePaise <= GST_LOW_RATE_LIMIT_PAISE ? 5 : 18;
}

/** CGST + SGST inside Karnataka (the seller's state), IGST everywhere else. */
export function gstTypeForState(state: string): GstType {
  const normalised = state.trim().toLowerCase();
  return normalised === 'karnataka' || normalised === 'ka' ? 'intra' : 'inter';
}

/**
 * Splits a GST-inclusive amount into taxable value and tax. Taxable value is rounded to
 * the nearest paisa; tax is the remainder, so the two always add up to the input.
 * `splitInclusive(59900, 5)` → `{ taxablePaise: 57048, taxPaise: 2852 }`.
 */
export function splitInclusive(
  grossPaise: number,
  ratePercent: number,
): { taxablePaise: number; taxPaise: number } {
  assertPaise(grossPaise, 'grossPaise');
  if (grossPaise < 0) throw new RangeError('grossPaise must not be negative');
  const taxablePaise = Math.round((grossPaise * 100) / (100 + ratePercent));
  return { taxablePaise, taxPaise: grossPaise - taxablePaise };
}

export interface GstBreakdown {
  gstType: GstType;
  ratePercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** cgst + sgst + igst */
  taxPaise: number;
}

/**
 * GST on a GST-inclusive amount for a customer in `state`. Intra-state tax is split into
 * equal CGST and SGST halves; an odd paisa goes to SGST.
 */
export function gstBreakdown(grossPaise: number, ratePercent: number, state: string): GstBreakdown {
  const { taxablePaise, taxPaise } = splitInclusive(grossPaise, ratePercent);
  const gstType = gstTypeForState(state);
  if (gstType === 'inter') {
    return {
      gstType,
      ratePercent,
      taxablePaise,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: taxPaise,
      taxPaise,
    };
  }
  const cgstPaise = Math.floor(taxPaise / 2);
  return {
    gstType,
    ratePercent,
    taxablePaise,
    cgstPaise,
    sgstPaise: taxPaise - cgstPaise,
    igstPaise: 0,
    taxPaise,
  };
}

/** GST for `qty` tees at a GST-inclusive unit price, using the per-piece rate rule. */
export function gstForTees(unitPriceInclPaise: number, qty: number, state: string): GstBreakdown {
  if (!Number.isSafeInteger(qty) || qty < 1) throw new RangeError('qty must be a positive integer');
  return gstBreakdown(unitPriceInclPaise * qty, gstRateForPiece(unitPriceInclPaise), state);
}
