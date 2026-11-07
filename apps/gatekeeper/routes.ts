// Gatekeeper routing table: store event type → the room that owns it and the role to mention.
// Source: docs/spec.md §10. Every event also goes to #events, so it is not listed here.
//
// `also` rooms are told without a mention: the event is posted there for context, but no
// agent is woken. Waking a second department on every order would double the agent work for
// information the owner hands off when it matters (decision 2026-11-07, docs/decisions.md).

import type { Department, EventType } from '@switch-gear/shared';

/** The nine Slack channels (docs/plan.md), each one a Switch room. */
export const CHANNELS = [
  'hq',
  'approvals',
  'engineering',
  'fulfilment',
  'finance',
  'marketing',
  'support',
  'research',
  'events',
] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Who is mentioned. A role name is mentioned as `@role`; `founder` is the founder's own
 * Switch name (SWITCH_FOUNDER_NAME), since the founder is a person, not a role.
 */
export type Mention =
  'chief-of-staff' | 'builder' | 'fulfilment' | 'finance' | 'marketing' | 'support' | 'founder';

export interface Route {
  room: Channel;
  /** null: posted for the record, nobody is woken. */
  mention: Mention | null;
  also: Channel[];
}

/** null: the event goes to #events only (order.placed is not in spec §10). */
export const ROUTES: Record<EventType, Route | null> = {
  'order.placed': null,
  'order.paid': { room: 'fulfilment', mention: 'fulfilment', also: ['finance'] },
  'payment.failed': { room: 'support', mention: 'support', also: [] },
  'order.cancelled': { room: 'support', mention: 'support', also: [] },
  'printjob.status': { room: 'fulfilment', mention: 'fulfilment', also: [] },
  'printjob.misprint': { room: 'fulfilment', mention: 'fulfilment', also: ['finance'] },
  'printjob.late': { room: 'fulfilment', mention: 'fulfilment', also: ['support'] },
  'shipment.delivered': { room: 'support', mention: 'support', also: ['finance'] },
  'shipment.failed': { room: 'fulfilment', mention: 'fulfilment', also: ['support', 'finance'] },
  'shipment.rto': { room: 'fulfilment', mention: 'fulfilment', also: ['support', 'finance'] },
  'ticket.created': { room: 'support', mention: 'support', also: [] },
  'refund.requested': { room: 'finance', mention: 'finance', also: [] },
  'invoice.received': { room: 'finance', mention: 'finance', also: ['fulfilment'] },
  'settlement.received': { room: 'finance', mention: 'finance', also: [] },
  'campaign.result': { room: 'marketing', mention: 'marketing', also: ['finance'] },
  'stock.low_blank': { room: 'fulfilment', mention: 'fulfilment', also: ['marketing'] },
  'checks.failed': { room: 'engineering', mention: 'builder', also: [] },
  'site.down': { room: 'engineering', mention: 'builder', also: ['approvals'] },
  // Also told: the requesting department, from payload.department (see departmentRoute).
  'approval.requested': { room: 'approvals', mention: 'founder', also: [] },
  // The result goes to #approvals for the record; the requesting department is mentioned in
  // its own room. Its department is not in the payload, so Gatekeeper looks the request up.
  'approval.decided': { room: 'approvals', mention: null, also: [] },
  'report.daily': { room: 'hq', mention: 'chief-of-staff', also: [] },
};

/** Where a department works and which role answers there. */
export function departmentRoute(department: Department): { room: Channel; mention: Mention } {
  switch (department) {
    case 'fulfilment':
    case 'finance':
    case 'marketing':
    case 'support':
      return { room: department, mention: department };
    case 'engineering':
      return { room: 'engineering', mention: 'builder' };
    case 'hq':
      return { room: 'hq', mention: 'chief-of-staff' };
    case 'founder':
      return { room: 'approvals', mention: 'founder' };
  }
}
