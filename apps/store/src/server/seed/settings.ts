// Approval limits and budgets from docs/spec.md §8, plus the demo clock speed.
// The store's approval gates (T-10) read these rows; change them here, not in code.
export const SETTINGS: Record<string, number> = {
  'approval.refund.maxPaise': 100000, // refunds above ₹1,000 need the founder
  'approval.refund.repeatWindowDays': 30, // a 2nd refund to a customer within 30 days
  'approval.reship.freePerOrder': 1, // a 2nd reship needs the founder
  'approval.payout.mismatchTolerancePaise': 10000, // invoice within ₹100 of records
  'approval.payout.maxPaise': 2500000, // any payout above ₹25,000
  'approval.discount.maxPercent': 20,
  'approval.discount.maxDays': 7,
  'budget.ads.weeklyPaise': 500000, // ₹5,000 a week; any increase needs the founder
  'clock.speed': 1, // 1 = real time
};

export const FEATURE_FLAGS: Record<string, boolean> = {
  'scenario.checkoutBug': false, // breaks the discount field (spec §9 scenario)
  'payments.cod': false, // cash on delivery is a stretch goal
  'sim.orderGenerator': true,
};

/** Setting row holding the founder's admin login: `{ email, passwordHash }`. */
export const FOUNDER_LOGIN_KEY = 'founder.login';
