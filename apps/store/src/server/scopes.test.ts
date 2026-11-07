import { describe, expect, it } from 'vitest';
import type { Department } from '../generated/prisma/client';
import { READ_SCOPES, WRITE_SCOPES, hasScope, type Scope } from './scopes';
import { DEPARTMENTS } from './api-keys';

const allowed = (department: Department): Scope[] =>
  [
    ...READ_SCOPES.map((n) => `${n}:read` as Scope),
    ...WRITE_SCOPES.map((n) => `${n}:write` as Scope),
  ].filter((s) => hasScope(department, s));

describe('department scopes (docs/architecture.md)', () => {
  const cases: Record<Department, { yes: Scope[]; no: Scope[] }> = {
    fulfilment: {
      yes: [
        'orders:read',
        'print_jobs:write',
        'shipments:write',
        'reship:write',
        'order_cancel:write',
      ],
      no: [
        'refunds:write',
        'payments:read',
        'ledger:read',
        'discount_codes:write',
        'tickets:read',
        'approval_decisions:write',
      ],
    },
    finance: {
      yes: [
        'payments:read',
        'ledger:read',
        'reports:read',
        'refunds:write',
        'partner_payouts:write',
        'ledger_adjustments:write',
      ],
      no: [
        'print_jobs:write',
        'shipments:write',
        'campaigns:write',
        'ticket_replies:write',
        'approval_decisions:write',
        'orders:read',
      ],
    },
    marketing: {
      yes: [
        'catalogue:read',
        'order_summary:read',
        'campaigns:read',
        'discount_codes:write',
        'campaigns:write',
        'ad_budget:write',
      ],
      no: [
        'orders:read',
        'refunds:write',
        'ledger:read',
        'print_jobs:write',
        'tickets:read',
        'approval_decisions:write',
      ],
    },
    support: {
      yes: [
        'orders:read',
        'shipments:read',
        'tickets:read',
        'ticket_replies:write',
        'refund_requests:write',
        'returns:write',
      ],
      no: [
        'refunds:write',
        'ledger:read',
        'print_jobs:write',
        'discount_codes:write',
        'approval_decisions:write',
      ],
    },
    engineering: {
      yes: ['health:read', 'error_log:read', 'flags:read', 'flags:write', 'rollback_marker:write'],
      no: [
        'orders:read',
        'refunds:write',
        'print_jobs:write',
        'events:read',
        'approval_decisions:write',
      ],
    },
    hq: {
      yes: [...READ_SCOPES.map((n) => `${n}:read` as Scope)],
      no: [...WRITE_SCOPES.map((n) => `${n}:write` as Scope)],
    },
    founder: {
      yes: [...READ_SCOPES.map((n) => `${n}:read` as Scope), 'approval_decisions:write'],
      no: WRITE_SCOPES.filter((n) => n !== 'approval_decisions').map((n) => `${n}:write` as Scope),
    },
  };

  for (const department of DEPARTMENTS) {
    it(`${department}: allows and denies the right scopes`, () => {
      const { yes, no } = cases[department];
      for (const scope of yes) expect(hasScope(department, scope), scope).toBe(true);
      for (const scope of no) expect(hasScope(department, scope), scope).toBe(false);
    });
  }

  it('only the founder key can record approval decisions', () => {
    expect(DEPARTMENTS.filter((d) => hasScope(d, 'approval_decisions:write'))).toEqual(['founder']);
  });

  it('every department has at least one scope', () => {
    for (const d of DEPARTMENTS) expect(allowed(d).length).toBeGreaterThan(0);
  });
});
