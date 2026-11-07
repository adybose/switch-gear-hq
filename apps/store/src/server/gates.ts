import { formatRupees } from '@switch-gear/shared/money';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';

// Approval gates (docs/spec.md §8). Each gate is a pure check of one request against the
// limits in `Setting` rows (seeded in seed/settings.ts). A gate says whether the action may
// run now or must wait for the founder, and why. The routes that own each action (refunds,
// reships, payouts, discount codes, campaigns) call these, then either run the action or
// call requestApproval() in approvals.ts. There is no bypass.

const paise = z.number().int().min(0);
const count = z.number().int().min(0);

const limitsSchema = z.object({
  'approval.refund.maxPaise': paise,
  'approval.refund.repeatWindowDays': count,
  'approval.reship.freePerOrder': count,
  'approval.payout.mismatchTolerancePaise': paise,
  'approval.payout.maxPaise': paise,
  'approval.discount.maxPercent': z.number().int().min(0).max(100),
  'approval.discount.maxDays': count,
  'budget.ads.weeklyPaise': paise,
});

export type Limits = z.infer<typeof limitsSchema>;
export const LIMIT_KEYS = Object.keys(limitsSchema.shape) as (keyof Limits)[];

/** Reads the current limits. A missing or malformed row is a setup bug, so it throws. */
export async function loadLimits(tx: Prisma.TransactionClient): Promise<Limits> {
  const rows = await tx.setting.findMany({ where: { key: { in: LIMIT_KEYS } } });
  const parsed = limitsSchema.safeParse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  if (!parsed.success) {
    throw new Error(`Approval limit settings are missing or invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** `ok: true` → run now. `ok: false` → needs the founder, for `reason`. */
export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };
const wait = (...reasons: string[]): Verdict => ({ ok: false, reason: reasons.join('; ') });

/**
 * Refund: alone if ≤ the limit, or for any order cancelled before printing. Founder if
 * above the limit, or if the customer already had a refund within the repeat window.
 */
export function refundGate(
  limits: Limits,
  r: { amountPaise: number; cancelledBeforePrinting: boolean; recentRefundsToCustomer: number },
): Verdict {
  if (r.cancelledBeforePrinting) return OK;
  const reasons: string[] = [];
  if (r.amountPaise > limits['approval.refund.maxPaise']) {
    reasons.push(
      `Refund of ${formatRupees(r.amountPaise)} is above the ${formatRupees(limits['approval.refund.maxPaise'])} limit`,
    );
  }
  if (r.recentRefundsToCustomer > 0) {
    reasons.push(
      `Customer already had a refund in the last ${limits['approval.refund.repeatWindowDays']} days`,
    );
  }
  return reasons.length ? wait(...reasons) : OK;
}

/** Reship: the first per order is free; any more need the founder. */
export function reshipGate(limits: Limits, r: { previousReships: number }): Verdict {
  const free = limits['approval.reship.freePerOrder'];
  return r.previousReships < free
    ? OK
    : wait(
        `Order already has ${r.previousReships} reship(s); only ${free} allowed without approval`,
      );
}

/** Partner payout: alone if the invoice is within tolerance of our records and ≤ the cap. */
export function payoutGate(
  limits: Limits,
  r: { invoicePaise: number; recordsPaise: number },
): Verdict {
  const reasons: string[] = [];
  const mismatch = Math.abs(r.invoicePaise - r.recordsPaise);
  if (mismatch > limits['approval.payout.mismatchTolerancePaise']) {
    reasons.push(
      `Invoice differs from records by ${formatRupees(mismatch)} (tolerance ${formatRupees(limits['approval.payout.mismatchTolerancePaise'])})`,
    );
  }
  if (r.invoicePaise > limits['approval.payout.maxPaise']) {
    reasons.push(
      `Payout of ${formatRupees(r.invoicePaise)} is above the ${formatRupees(limits['approval.payout.maxPaise'])} limit`,
    );
  }
  return reasons.length ? wait(...reasons) : OK;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Discount code: alone if ≤ the max percent and it ends within the max days of starting. */
export function discountCodeGate(
  limits: Limits,
  r: { percent: number; startsAt: Date; endsAt: Date | null },
): Verdict {
  const reasons: string[] = [];
  const maxPercent = limits['approval.discount.maxPercent'];
  const maxDays = limits['approval.discount.maxDays'];
  if (r.percent > maxPercent) reasons.push(`${r.percent}% off is above the ${maxPercent}% limit`);
  if (r.endsAt === null) {
    reasons.push('Code has no end date');
  } else if (r.endsAt.getTime() - r.startsAt.getTime() > maxDays * DAY_MS) {
    reasons.push(`Code runs longer than ${maxDays} days`);
  }
  return reasons.length ? wait(...reasons) : OK;
}

/**
 * Ad spend: alone while this week's committed budget plus the new request stays within the
 * weekly budget. Anything beyond it is a budget increase and needs the founder.
 */
export function adBudgetGate(
  limits: Limits,
  r: { committedThisWeekPaise: number; requestedPaise: number },
): Verdict {
  const weekly = limits['budget.ads.weeklyPaise'];
  const total = r.committedThisWeekPaise + r.requestedPaise;
  return total <= weekly
    ? OK
    : wait(
        `This week's ad budget would be ${formatRupees(total)}, above the ${formatRupees(weekly)} weekly budget`,
      );
}
