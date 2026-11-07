import type { Department } from '../generated/prisma/client';

/**
 * API key scopes (docs/architecture.md "Auth and API keys"). A scope is `<name>:read` or
 * `<name>:write`. Every non-public endpoint declares the one scope it needs; `authorize()`
 * in auth.ts turns a missing scope into a 403.
 */
export const READ_SCOPES = [
  'orders',
  'print_jobs',
  'shipments',
  'payments',
  'ledger',
  'invoices',
  'partner_invoices',
  'reports',
  'catalogue',
  'campaigns',
  'discount_codes',
  'tickets',
  'health',
  'error_log',
  'flags',
  'approvals',
  'events',
] as const;

export const WRITE_SCOPES = [
  'print_jobs',
  'shipments',
  'reship',
  'order_cancel',
  'refunds',
  'partner_payouts',
  'ledger_adjustments',
  'discount_codes',
  'campaigns',
  'ad_budget',
  'ticket_replies',
  'refund_requests',
  'returns',
  'flags',
  'rollback_marker',
  'approval_decisions',
] as const;

export type Scope =
  `${(typeof READ_SCOPES)[number]}:read` | `${(typeof WRITE_SCOPES)[number]}:write`;

const reads = (...names: (typeof READ_SCOPES)[number][]): Scope[] =>
  names.map((n) => `${n}:read` as const);
const writes = (...names: (typeof WRITE_SCOPES)[number][]): Scope[] =>
  names.map((n) => `${n}:write` as const);

const ALL_READS = reads(...READ_SCOPES);

const SCOPES: Record<Department, ReadonlySet<Scope>> = {
  fulfilment: new Set([
    ...reads('orders', 'print_jobs', 'shipments'),
    ...writes('print_jobs', 'shipments', 'reship', 'order_cancel'),
  ]),
  finance: new Set([
    ...reads('payments', 'ledger', 'invoices', 'partner_invoices', 'reports'),
    ...writes('refunds', 'partner_payouts', 'ledger_adjustments'),
  ]),
  marketing: new Set([
    ...reads('catalogue', 'orders', 'campaigns', 'discount_codes'),
    ...writes('discount_codes', 'campaigns', 'ad_budget'),
  ]),
  support: new Set([
    ...reads('orders', 'shipments', 'tickets'),
    ...writes('ticket_replies', 'refund_requests', 'returns'),
  ]),
  engineering: new Set([
    ...reads('health', 'error_log', 'flags'),
    ...writes('flags', 'rollback_marker'),
  ]),
  hq: new Set(ALL_READS),
  founder: new Set([...ALL_READS, ...writes('approval_decisions')]),
};

export function hasScope(department: Department, scope: Scope): boolean {
  return SCOPES[department].has(scope);
}
