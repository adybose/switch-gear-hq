// Business events (docs/spec.md §10, plus approval.decided from docs/architecture.md and
// order.placed from T-06).
// The store writes them to the Event outbox; Gatekeeper reads them from GET /api/v1/events.
// Payloads carry human-facing IDs (ORD-1042, APR-7) and money in paise, never personal data.

import type { GstType } from './money';

export type Department =
  'fulfilment' | 'finance' | 'marketing' | 'support' | 'engineering' | 'hq' | 'founder';

export type Partner = 'printhub' | 'shipfast';

/** ISO 8601 UTC timestamp. */
export type IsoDate = string;

export interface EventPayloads {
  /** From T-06 (checkout); not in the spec §10 routing table. */
  'order.placed': {
    orderNumber: string;
    totalPaise: number;
    itemCount: number;
    source: 'web' | 'generator';
  };
  'order.paid': {
    orderNumber: string;
    totalPaise: number;
    itemCount: number;
    gstType: GstType;
    paidAt: IsoDate;
  };
  'payment.failed': {
    orderNumber: string;
    gatewayRef: string;
    amountPaise: number;
    reason: string;
  };
  /** An order cancelled for a reason other than a failed payment, e.g. not paid in time. */
  'order.cancelled': {
    orderNumber: string;
    totalPaise: number;
    reason: 'unpaid_timeout';
  };
  'printjob.misprint': {
    orderNumber: string;
    partnerRef: string;
    attempt: number;
    skus: string[];
  };
  'printjob.late': {
    orderNumber: string;
    partnerRef: string;
    status: string;
    dueAt: IsoDate;
  };
  'shipment.delivered': {
    orderNumber: string;
    awb: string;
    deliveredAt: IsoDate;
  };
  'shipment.failed': {
    orderNumber: string;
    awb: string;
    attempt: number;
    reason: string;
  };
  'shipment.rto': {
    orderNumber: string;
    awb: string;
    reason: string;
  };
  'ticket.created': {
    ticketNumber: string;
    orderNumber: string | null;
    type: 'wismo' | 'exchange' | 'return' | 'complaint' | 'other';
  };
  'refund.requested': {
    orderNumber: string;
    refundId: string;
    amountPaise: number;
    reason: string;
    /** Set when the refund is over a limit and waits for the founder. */
    approvalId: string | null;
  };
  'invoice.received': {
    partner: Partner;
    partnerRef: string;
    periodStart: IsoDate;
    periodEnd: IsoDate;
    totalPaise: number;
    gstPaise: number;
  };
  'settlement.received': {
    settlementRef: string;
    amountPaise: number;
    feePaise: number;
    paymentCount: number;
    settledAt: IsoDate;
  };
  'campaign.result': {
    campaignId: string;
    name: string;
    channel: 'instagram' | 'google' | 'influencer';
    spentPaise: number;
    clicks: number;
    orders: number;
    revenuePaise: number;
  };
  'stock.low_blank': {
    partner: 'printhub';
    fit: 'classic' | 'oversized' | 'premium';
    colour: string;
    size: string | null;
  };
  'checks.failed': {
    check: string;
    details: string;
  };
  'site.down': {
    url: string;
    since: IsoDate;
    statusCode: number | null;
  };
  'approval.requested': {
    approvalId: string;
    department: Department;
    action: string;
    amountPaise: number | null;
    reason: string;
  };
  'approval.decided': {
    approvalId: string;
    action: string;
    decision: 'approved' | 'rejected' | 'expired';
    decidedBy: string;
    reason: string | null;
  };
  'report.daily': {
    date: string;
    orders: number;
    revenuePaise: number;
    grossMarginPaise: number;
    refundsPaise: number;
    adSpendPaise: number;
    openTickets: number;
  };
}

export type EventType = keyof EventPayloads;

/** Every event type, in spec §10 order. */
export const EVENT_TYPES = [
  'order.placed',
  'order.paid',
  'payment.failed',
  'order.cancelled',
  'printjob.misprint',
  'printjob.late',
  'shipment.delivered',
  'shipment.failed',
  'shipment.rto',
  'ticket.created',
  'refund.requested',
  'invoice.received',
  'settlement.received',
  'campaign.result',
  'stock.low_blank',
  'checks.failed',
  'site.down',
  'approval.requested',
  'approval.decided',
  'report.daily',
] as const satisfies readonly EventType[];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** One outbox row as returned by GET /api/v1/events. */
export type StoreEvent<T extends EventType = EventType> = {
  [K in T]: {
    seq: number;
    type: K;
    entityType: string;
    entityId: string;
    payload: EventPayloads[K];
    createdAt: IsoDate;
  };
}[T];
