import { describe, expect, it } from 'vitest';
import {
  adBudgetGate,
  discountCodeGate,
  LIMIT_KEYS,
  type Limits,
  payoutGate,
  refundGate,
  reshipGate,
} from './gates';
import { SETTINGS } from './seed/settings';

// The seeded limits (docs/spec.md §8), so these tests check the real boundaries.
const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, SETTINGS[k]])) as Limits;

describe('approval limits', () => {
  it('are all seeded', () => {
    for (const key of LIMIT_KEYS) expect(SETTINGS[key], key).toBeTypeOf('number');
  });
});

describe('refund gate', () => {
  const refund = (amountPaise: number, extra: Partial<Parameters<typeof refundGate>[1]> = {}) =>
    refundGate(limits, {
      amountPaise,
      cancelledBeforePrinting: false,
      recentRefundsToCustomer: 0,
      ...extra,
    });

  it('passes ₹1,000 and holds ₹1,001', () => {
    expect(refund(100000)).toEqual({ ok: true });
    expect(refund(100100)).toEqual({
      ok: false,
      reason: 'Refund of ₹1,001 is above the ₹1,000 limit',
    });
    expect(refund(100001).ok).toBe(false); // a single paisa over
  });

  it('holds a 2nd refund to the same customer within the window', () => {
    expect(refund(5000, { recentRefundsToCustomer: 1 })).toEqual({
      ok: false,
      reason: 'Customer already had a refund in the last 30 days',
    });
  });

  it('gives both reasons when both apply', () => {
    const v = refund(200000, { recentRefundsToCustomer: 2 });
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason.split('; ')).toHaveLength(2);
  });

  it('passes any refund for an order cancelled before printing', () => {
    expect(refund(500000, { cancelledBeforePrinting: true, recentRefundsToCustomer: 3 })).toEqual({
      ok: true,
    });
  });
});

describe('reship gate', () => {
  it('passes the 1st reship and holds the 2nd', () => {
    expect(reshipGate(limits, { previousReships: 0 })).toEqual({ ok: true });
    expect(reshipGate(limits, { previousReships: 1 })).toEqual({
      ok: false,
      reason: 'Order already has 1 reship(s); only 1 allowed without approval',
    });
  });
});

describe('payout gate', () => {
  it('passes a ₹100 mismatch and holds ₹100.01', () => {
    expect(payoutGate(limits, { invoicePaise: 110000, recordsPaise: 100000 })).toEqual({
      ok: true,
    });
    expect(payoutGate(limits, { invoicePaise: 90000, recordsPaise: 100000 })).toEqual({
      ok: true,
    });
    expect(payoutGate(limits, { invoicePaise: 110001, recordsPaise: 100000 })).toEqual({
      ok: false,
      reason: 'Invoice differs from records by ₹100.01 (tolerance ₹100)',
    });
  });

  it('passes ₹25,000 and holds ₹25,000.01 even when it matches the records', () => {
    expect(payoutGate(limits, { invoicePaise: 2500000, recordsPaise: 2500000 })).toEqual({
      ok: true,
    });
    expect(payoutGate(limits, { invoicePaise: 2500001, recordsPaise: 2500001 })).toEqual({
      ok: false,
      reason: 'Payout of ₹25,000.01 is above the ₹25,000 limit',
    });
  });
});

describe('discount code gate', () => {
  const start = new Date('2026-11-07T00:00:00.000Z');
  const days = (n: number) => new Date(start.getTime() + n * 24 * 60 * 60 * 1000);
  const code = (percent: number, endsAt: Date | null) =>
    discountCodeGate(limits, { percent, startsAt: start, endsAt });

  it('passes 20% for 7 days and holds 21%', () => {
    expect(code(20, days(7))).toEqual({ ok: true });
    expect(code(21, days(7))).toEqual({ ok: false, reason: '21% off is above the 20% limit' });
  });

  it('holds a code longer than 7 days or with no end date', () => {
    expect(code(10, new Date(days(7).getTime() + 1))).toEqual({
      ok: false,
      reason: 'Code runs longer than 7 days',
    });
    expect(code(10, null)).toEqual({ ok: false, reason: 'Code has no end date' });
  });
});

describe('ad budget gate', () => {
  it('passes spend up to ₹5,000 a week and holds anything above', () => {
    expect(
      adBudgetGate(limits, { committedThisWeekPaise: 300000, requestedPaise: 200000 }),
    ).toEqual({ ok: true });
    expect(
      adBudgetGate(limits, { committedThisWeekPaise: 300000, requestedPaise: 200001 }),
    ).toEqual({
      ok: false,
      reason: "This week's ad budget would be ₹5,000.01, above the ₹5,000 weekly budget",
    });
  });
});
