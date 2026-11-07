import type { FlagSpec } from './args';

/** One positional argument: filled into the URL path or the JSON body. */
export interface ArgSpec {
  name: string;
  in: 'path' | 'body';
  /** Body key; defaults to the argument name. */
  key?: string;
  /** `onoff` turns "on"/"off" into a boolean. */
  type?: 'string' | 'onoff';
}

export interface Command {
  /** Words typed after `sg`, e.g. ['refunds', 'create']. */
  words: readonly string[];
  summary: string;
  method: 'GET' | 'POST' | 'PUT';
  /** Path under /api/v1 with `{param}` placeholders for path arguments. */
  path: string;
  args?: readonly ArgSpec[];
  flags?: Record<string, FlagSpec>;
  /** Fixed body fields, e.g. the decision of `approvals approve`. */
  fixed?: Record<string, unknown>;
  example: string;
}

const status = (choices?: readonly string[]): Record<string, FlagSpec> => ({
  status: choices ? { type: 'string', choices } : { type: 'string' },
});
const orderArg: ArgSpec = { name: 'order', in: 'body', key: 'orderNumber' };
const ticketFlag: FlagSpec = { type: 'string', key: 'ticketNumber' };

// One entry per endpoint in api/openapi.yaml that a department uses. The store enforces the
// scopes; the CLI only builds the request.
export const COMMANDS: readonly Command[] = [
  {
    words: ['health'],
    summary: 'Check the store is up',
    method: 'GET',
    path: '/health',
    example: 'sg health',
  },

  // orders
  {
    words: ['orders', 'list'],
    summary: 'List orders',
    method: 'GET',
    path: '/orders',
    flags: {
      ...status([
        'placed',
        'paid',
        'printing',
        'shipped',
        'delivered',
        'cancelled',
        'returned',
        'refunded',
      ]),
      limit: { type: 'int' },
    },
    example: 'sg orders list --status paid',
  },
  {
    words: ['orders', 'get'],
    summary: 'Show one order',
    method: 'GET',
    path: '/orders/{number}',
    args: [{ name: 'number', in: 'path' }],
    example: 'sg orders get ORD-1042',
  },
  {
    words: ['orders', 'cancel'],
    summary: 'Cancel an order before printing (full refund)',
    method: 'POST',
    path: '/orders/{number}/cancel',
    args: [{ name: 'number', in: 'path' }],
    example: 'sg orders cancel ORD-1042',
  },

  // fulfilment
  {
    words: ['print-jobs', 'list'],
    summary: 'List print jobs',
    method: 'GET',
    path: '/print-jobs',
    flags: status(),
    example: 'sg print-jobs list --status misprinted',
  },
  {
    words: ['print-jobs', 'create'],
    summary: 'Send a paid order to PrintHub',
    method: 'POST',
    path: '/print-jobs',
    args: [orderArg],
    example: 'sg print-jobs create ORD-1042',
  },
  {
    words: ['print-jobs', 'reprint'],
    summary: 'Free reprint of a misprinted job (store job id)',
    method: 'POST',
    path: '/print-jobs/{id}/reprint',
    args: [{ name: 'id', in: 'path' }],
    example: 'sg print-jobs reprint pj_123',
  },
  {
    words: ['shipments', 'list'],
    summary: 'List shipments',
    method: 'GET',
    path: '/shipments',
    flags: status(),
    example: 'sg shipments list --status failed',
  },
  {
    words: ['shipments', 'create'],
    summary: 'Book a shipment with ShipFast',
    method: 'POST',
    path: '/shipments',
    args: [orderArg],
    example: 'sg shipments create ORD-1042',
  },
  {
    words: ['shipments', 'reship'],
    summary: 'Book a reship (may need founder approval)',
    method: 'POST',
    path: '/shipments/{id}/reship',
    args: [{ name: 'id', in: 'path' }],
    example: 'sg shipments reship sh_123',
  },

  // finance
  {
    words: ['refunds', 'list'],
    summary: 'List refunds',
    method: 'GET',
    path: '/refunds',
    example: 'sg refunds list',
  },
  {
    words: ['refunds', 'create'],
    summary: 'Refund an order (over the limit waits for the founder)',
    method: 'POST',
    path: '/refunds',
    args: [orderArg],
    flags: {
      amount: { type: 'rupees', required: true, key: 'amountPaise' },
      reason: { type: 'string', required: true },
      ticket: ticketFlag,
    },
    example: 'sg refunds create ORD-1042 --amount 799 --reason misprint',
  },
  {
    words: ['refunds', 'request'],
    summary: 'Ask Finance for a refund (moves no money)',
    method: 'POST',
    path: '/refund-requests',
    args: [orderArg],
    flags: {
      amount: { type: 'rupees', required: true, key: 'amountPaise' },
      reason: { type: 'string', required: true },
      ticket: ticketFlag,
    },
    example: 'sg refunds request ORD-1042 --amount 799 --reason "wrong size" --ticket TCK-7',
  },
  {
    words: ['invoices', 'get'],
    summary: 'Show a GST invoice',
    method: 'GET',
    path: '/invoices/{number}',
    args: [{ name: 'number', in: 'path' }],
    example: 'sg invoices get INV-2026-00042',
  },
  {
    words: ['partner-invoices', 'list'],
    summary: 'List partner invoices',
    method: 'GET',
    path: '/partner-invoices',
    flags: status(),
    example: 'sg partner-invoices list --status received',
  },
  {
    words: ['partner-invoices', 'verify'],
    summary: 'Compare an invoice with our records',
    method: 'POST',
    path: '/partner-invoices/{id}/verify',
    args: [{ name: 'id', in: 'path' }],
    example: 'sg partner-invoices verify pi_123',
  },
  {
    words: ['partner-invoices', 'pay'],
    summary: 'Pay a verified partner invoice (may need founder approval)',
    method: 'POST',
    path: '/partner-invoices/{id}/pay',
    args: [{ name: 'id', in: 'path' }],
    example: 'sg partner-invoices pay pi_123',
  },
  {
    words: ['partner-invoices', 'dispute'],
    summary: 'Dispute a partner invoice',
    method: 'POST',
    path: '/partner-invoices/{id}/dispute',
    args: [{ name: 'id', in: 'path' }],
    flags: { reason: { type: 'string', required: true } },
    example: 'sg partner-invoices dispute pi_123 --reason "billed twice"',
  },
  {
    words: ['ledger'],
    summary: 'Show ledger entries',
    method: 'GET',
    path: '/ledger',
    flags: { from: { type: 'string' }, to: { type: 'string' }, account: { type: 'string' } },
    example: 'sg ledger --from 2026-11-01 --account cash',
  },
  {
    words: ['reports', 'pnl'],
    summary: 'Daily profit and loss',
    method: 'GET',
    path: '/reports/pnl',
    flags: { date: { type: 'string' } },
    example: 'sg reports pnl --date 2026-11-07',
  },
  {
    words: ['reports', 'gst'],
    summary: 'Monthly GST summary',
    method: 'GET',
    path: '/reports/gst',
    flags: { month: { type: 'string' } },
    example: 'sg reports gst --month 2026-11',
  },

  // marketing
  {
    words: ['discount-codes', 'list'],
    summary: 'List discount codes',
    method: 'GET',
    path: '/discount-codes',
    example: 'sg discount-codes list',
  },
  {
    words: ['discount-codes', 'create'],
    summary: 'Create a discount code (over the limit waits for the founder)',
    method: 'POST',
    path: '/discount-codes',
    args: [{ name: 'code', in: 'body' }],
    flags: {
      percent: { type: 'int', required: true },
      ends: { type: 'string', required: true, key: 'endsAt' },
      starts: { type: 'string', key: 'startsAt' },
    },
    example: 'sg discount-codes create DIWALI15 --percent 15 --ends 2026-11-12T18:29:59Z',
  },
  {
    words: ['campaigns', 'list'],
    summary: 'List campaigns',
    method: 'GET',
    path: '/campaigns',
    example: 'sg campaigns list',
  },
  {
    words: ['campaigns', 'create'],
    summary: 'Start an ad campaign (budget over the limit waits for the founder)',
    method: 'POST',
    path: '/campaigns',
    flags: {
      name: { type: 'string', required: true },
      channel: { type: 'string', required: true, choices: ['instagram', 'google', 'influencer'] },
      budget: { type: 'rupees', required: true, key: 'budgetPaise' },
      starts: { type: 'string', key: 'startsAt' },
      ends: { type: 'string', key: 'endsAt' },
    },
    example: 'sg campaigns create --name "Diwali reels" --channel instagram --budget 5000',
  },

  // support
  {
    words: ['tickets', 'list'],
    summary: 'List tickets',
    method: 'GET',
    path: '/tickets',
    flags: status(['open', 'waiting', 'closed']),
    example: 'sg tickets list --status open',
  },
  {
    words: ['tickets', 'get'],
    summary: 'Show one ticket',
    method: 'GET',
    path: '/tickets/{number}',
    args: [{ name: 'number', in: 'path' }],
    example: 'sg tickets get TCK-7',
  },
  {
    words: ['tickets', 'reply'],
    summary: 'Reply to a ticket by email',
    method: 'POST',
    path: '/tickets/{number}/reply',
    args: [{ name: 'number', in: 'path' }],
    flags: { message: { type: 'string', required: true }, close: { type: 'bool' } },
    example: 'sg tickets reply TCK-7 --message "Your tee ships today" --close',
  },
  {
    words: ['returns', 'create'],
    summary: 'Book a return pickup',
    method: 'POST',
    path: '/returns',
    args: [orderArg],
    flags: {
      reason: { type: 'string', required: true, choices: ['size', 'defect', 'other'] },
      ticket: ticketFlag,
    },
    example: 'sg returns create ORD-1042 --reason size --ticket TCK-7',
  },

  // approvals
  {
    words: ['approvals', 'list'],
    summary: 'List approval requests',
    method: 'GET',
    path: '/approvals',
    flags: status(['pending', 'approved', 'rejected', 'expired']),
    example: 'sg approvals list --status pending',
  },
  {
    words: ['approvals', 'get'],
    summary: 'Show one approval request',
    method: 'GET',
    path: '/approvals/{id}',
    args: [{ name: 'id', in: 'path' }],
    example: 'sg approvals get APR-7',
  },
  {
    words: ['approvals', 'approve'],
    summary: 'Approve a request (founder key only)',
    method: 'POST',
    path: '/approvals/{id}/decision',
    args: [{ name: 'id', in: 'path' }],
    fixed: { decision: 'approve' },
    example: 'sg approvals approve APR-7',
  },
  {
    words: ['approvals', 'reject'],
    summary: 'Reject a request (founder key only)',
    method: 'POST',
    path: '/approvals/{id}/decision',
    args: [{ name: 'id', in: 'path' }],
    fixed: { decision: 'reject' },
    flags: { reason: { type: 'string', required: true } },
    example: 'sg approvals reject APR-7 --reason "too high"',
  },

  // platform
  {
    words: ['events'],
    summary: 'Read outbox events after a sequence number',
    method: 'GET',
    path: '/events',
    flags: { after: { type: 'int' }, limit: { type: 'int' } },
    example: 'sg events --after 120 --limit 50',
  },
  {
    words: ['flags', 'list'],
    summary: 'List feature flags',
    method: 'GET',
    path: '/flags',
    example: 'sg flags list',
  },
  {
    words: ['flags', 'set'],
    summary: 'Turn a feature flag on or off',
    method: 'PUT',
    path: '/flags/{key}',
    args: [
      { name: 'key', in: 'path' },
      { name: 'state', in: 'body', key: 'enabled', type: 'onoff' },
    ],
    example: 'sg flags set checkout off',
  },
];
