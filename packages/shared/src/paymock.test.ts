import { describe, expect, it } from 'vitest';
import { gatewayFee, isUnpaidExpired, settlementNet } from './paymock';

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
  const deadline = {
    expiresAt: new Date('2026-11-07T10:30:00.000Z'), // business: placed 10:00 + 30 min
    minExpiresAt: new Date('2026-11-07T08:05:00.000Z'), // real: created 08:00 + 5 min
  };
  const before = (d: Date) => new Date(d.getTime() - 1);

  it('expires only once both 30 business and 5 real minutes have passed', () => {
    expect(isUnpaidExpired(deadline, deadline.expiresAt, deadline.minExpiresAt)).toBe(true);
    // Demo speed: a business day has gone by, but not 5 real minutes.
    const dayLater = new Date('2026-11-08T10:00:00.000Z');
    expect(isUnpaidExpired(deadline, dayLater, before(deadline.minExpiresAt))).toBe(false);
    // Slow clock: 5 real minutes have gone by, but not 30 business minutes.
    expect(isUnpaidExpired(deadline, before(deadline.expiresAt), dayLater)).toBe(false);
  });
});
