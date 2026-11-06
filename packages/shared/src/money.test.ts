import { describe, expect, it } from 'vitest';
import {
  assertPaise,
  formatRupees,
  gstBreakdown,
  gstForTees,
  gstRateForPiece,
  gstTypeForState,
  percentOf,
  rupeesToPaise,
  splitInclusive,
  sumPaise,
} from './money';

describe('paise helpers', () => {
  it('accepts only integer paise', () => {
    expect(assertPaise(59900)).toBe(59900);
    expect(() => assertPaise(599.5)).toThrow(RangeError);
    expect(() => assertPaise(Number.NaN)).toThrow(RangeError);
  });

  it('converts rupees to paise without float drift', () => {
    expect(rupeesToPaise(599)).toBe(59900);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(() => rupeesToPaise(1.005)).toThrow(RangeError);
  });

  it('sums paise', () => {
    expect(sumPaise(59900, 79900, 7900)).toBe(147700);
    expect(() => sumPaise(1, 0.5)).toThrow(RangeError);
  });

  it('takes percentages rounded to the nearest paisa', () => {
    expect(percentOf(179700, 10)).toBe(17970);
    expect(percentOf(59900, 15)).toBe(8985);
    expect(percentOf(5, 50)).toBe(3); // 2.5 rounds up
    expect(percentOf(-5, 50)).toBe(-3);
  });
});

describe('formatRupees', () => {
  it('formats whole rupees with Indian grouping', () => {
    expect(formatRupees(129900)).toBe('₹1,299');
    expect(formatRupees(59900)).toBe('₹599');
    expect(formatRupees(10000000)).toBe('₹1,00,000');
    expect(formatRupees(0)).toBe('₹0');
  });

  it('shows paise only when there are some', () => {
    expect(formatRupees(129950)).toBe('₹1,299.50');
    expect(formatRupees(5)).toBe('₹0.05');
  });

  it('formats negatives', () => {
    expect(formatRupees(-5000)).toBe('-₹50');
  });
});

describe('GST', () => {
  it('matches the before-GST prices in spec §2', () => {
    // ₹599 → ₹570, ₹799 → ₹761, ₹999 → ₹951 (spec shows whole rupees)
    expect(splitInclusive(59900, 5)).toEqual({ taxablePaise: 57048, taxPaise: 2852 });
    expect(splitInclusive(79900, 5)).toEqual({ taxablePaise: 76095, taxPaise: 3805 });
    expect(splitInclusive(99900, 5)).toEqual({ taxablePaise: 95143, taxPaise: 4757 });
  });

  it('always adds back up to the inclusive amount', () => {
    for (const gross of [0, 1, 7900, 59900, 123457, 999999]) {
      for (const rate of [5, 18]) {
        const { taxablePaise, taxPaise } = splitInclusive(gross, rate);
        expect(taxablePaise + taxPaise).toBe(gross);
      }
    }
  });

  it('uses 5% up to ₹2,500 a piece before GST, 18% above', () => {
    expect(gstRateForPiece(99900)).toBe(5);
    expect(gstRateForPiece(262500)).toBe(5); // exactly ₹2,500 before 5% GST
    expect(gstRateForPiece(262501)).toBe(18);
  });

  it('is intra-state only for Karnataka', () => {
    expect(gstTypeForState('Karnataka')).toBe('intra');
    expect(gstTypeForState(' karnataka ')).toBe('intra');
    expect(gstTypeForState('KA')).toBe('intra');
    expect(gstTypeForState('Tamil Nadu')).toBe('inter');
  });

  it('splits intra-state tax into CGST and SGST, odd paisa to SGST', () => {
    expect(gstBreakdown(59900, 5, 'Karnataka')).toEqual({
      gstType: 'intra',
      ratePercent: 5,
      taxablePaise: 57048,
      cgstPaise: 1426,
      sgstPaise: 1426,
      igstPaise: 0,
      taxPaise: 2852,
    });
    const odd = gstBreakdown(79900, 5, 'Karnataka');
    expect([odd.cgstPaise, odd.sgstPaise]).toEqual([1902, 1903]);
  });

  it('charges IGST outside Karnataka', () => {
    expect(gstBreakdown(59900, 5, 'Maharashtra')).toEqual({
      gstType: 'inter',
      ratePercent: 5,
      taxablePaise: 57048,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2852,
      taxPaise: 2852,
    });
  });

  it('works out GST for several tees at the per-piece rate', () => {
    const gst = gstForTees(79900, 3, 'Delhi');
    expect(gst.ratePercent).toBe(5);
    expect(gst.taxablePaise + gst.taxPaise).toBe(239700);
    expect(gstForTees(300000, 1, 'Delhi').ratePercent).toBe(18);
    expect(() => gstForTees(79900, 0, 'Delhi')).toThrow(RangeError);
  });

  it('rejects negative or fractional amounts', () => {
    expect(() => splitInclusive(-1, 5)).toThrow(RangeError);
    expect(() => splitInclusive(10.5, 5)).toThrow(RangeError);
  });
});
