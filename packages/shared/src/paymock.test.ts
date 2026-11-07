import { describe, expect, it } from 'vitest';
import { gatewayFee, settlementNet, unpaidDeadline } from './paymock';

describe('PayMock fee', () => {
  it('is 2% plus 18% GST on the fee, in whole paise', () => {
    // ₹599: 2% = ₹11.98, GST 18% of that = ₹2.1564 → ₹2.16
    expect(gatewayFee(59900)).toEqual({ feePaise: 1198, feeGstPaise: 216 });
    // ₹1,557: 2% = ₹31.14, GST = ₹5.6052 → ₹5.61
    expect(gatewayFee(155700)).toEqual({ feePaise: 3114, feeGstPaise: 561 });
    // Rounds halves up: 2% of 25 paise is 0.5 → 1; GST on 1 paisa is 0.18 → 0
    expect(gatewayFee(25)).toEqual({ feePaise: 1, feeGstPaise: 0 });
  });

  it('settles the payment minus the fee and its GST', () => {
    expect(settlementNet(59900, gatewayFee(59900))).toBe(59900 - 1198 - 216);
  });
});

describe('unpaid deadline', () => {
  const placed = new Date('2026-11-07T10:00:00.000Z');

  it('is 30 business minutes at real-time speed', () => {
    expect(unpaidDeadline(placed, 1).toISOString()).toBe('2026-11-07T10:30:00.000Z');
  });

  it('is never less than 5 real minutes at demo speed', () => {
    // Demo speed: 1 business day in 10 real minutes = 144×. 5 real minutes = 12 business hours.
    expect(unpaidDeadline(placed, 144).toISOString()).toBe('2026-11-07T22:00:00.000Z');
    // At 6× the two rules meet: 30 business minutes = 5 real minutes.
    expect(unpaidDeadline(placed, 6).toISOString()).toBe('2026-11-07T10:30:00.000Z');
  });
});
