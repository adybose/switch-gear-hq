// Event → one short Slack line. Plain code, no AI: the same event always reads the same way.

import { formatRupees, isEventType, type StoreEvent } from '@switch-gear/shared';

/** One line describing an event: `order.paid` · ORD-1042 · ₹799 · 1 item. */
export function describeEvent(event: StoreEvent): string {
  const head = `\`${event.type}\``;
  let parts: string[];
  try {
    parts = isEventType(event.type) ? details(event) : [event.entityId];
  } catch {
    // A payload that doesn't match its type (an older or newer store) still gets posted.
    parts = [event.entityId];
  }
  return [head, ...parts.filter((p) => p !== undefined && p !== '')].join(' · ');
}

function details(event: StoreEvent): string[] {
  switch (event.type) {
    case 'order.placed':
      return [
        event.payload.orderNumber,
        formatRupees(event.payload.totalPaise),
        items(event.payload.itemCount),
        event.payload.source,
      ];
    case 'order.paid':
      return [
        event.payload.orderNumber,
        formatRupees(event.payload.totalPaise),
        items(event.payload.itemCount),
      ];
    case 'payment.failed':
      return [
        event.payload.orderNumber,
        formatRupees(event.payload.amountPaise),
        event.payload.reason,
      ];
    case 'order.cancelled':
      return [
        event.payload.orderNumber,
        formatRupees(event.payload.totalPaise),
        event.payload.reason,
      ];
    case 'printjob.status':
      return [
        event.payload.orderNumber,
        event.payload.partnerRef,
        event.payload.status,
        `attempt ${event.payload.attempt}`,
      ];
    case 'printjob.misprint':
      return [
        event.payload.orderNumber,
        event.payload.partnerRef,
        `attempt ${event.payload.attempt}`,
        event.payload.skus.join(', '),
      ];
    case 'printjob.late':
      return [
        event.payload.orderNumber,
        event.payload.partnerRef,
        event.payload.status,
        `due ${event.payload.dueAt}`,
      ];
    case 'shipment.delivered':
      return [event.payload.orderNumber, `AWB ${event.payload.awb}`];
    case 'shipment.failed':
      return [
        event.payload.orderNumber,
        `AWB ${event.payload.awb}`,
        `attempt ${event.payload.attempt}`,
        event.payload.reason,
      ];
    case 'shipment.rto':
      return [event.payload.orderNumber, `AWB ${event.payload.awb}`, event.payload.reason];
    case 'ticket.created':
      return [
        event.payload.ticketNumber,
        event.payload.type,
        event.payload.orderNumber ?? 'no order',
      ];
    case 'refund.requested':
      return [
        event.payload.orderNumber,
        event.payload.refundId,
        formatRupees(event.payload.amountPaise),
        event.payload.reason,
        ...(event.payload.approvalId ? [`waits for ${event.payload.approvalId}`] : []),
      ];
    case 'invoice.received':
      return [
        event.payload.partner,
        event.payload.partnerRef,
        formatRupees(event.payload.totalPaise),
      ];
    case 'settlement.received':
      return [
        event.payload.settlementRef,
        formatRupees(event.payload.amountPaise),
        `fee ${formatRupees(event.payload.feePaise)}`,
        `${event.payload.paymentCount} payments`,
      ];
    case 'campaign.result':
      return [
        event.payload.name,
        event.payload.channel,
        `spent ${formatRupees(event.payload.spentPaise)}`,
        `${event.payload.orders} orders`,
        `revenue ${formatRupees(event.payload.revenuePaise)}`,
      ];
    case 'stock.low_blank':
      return [
        event.payload.partner,
        [event.payload.fit, event.payload.colour, event.payload.size].filter(Boolean).join(' '),
      ];
    case 'checks.failed':
      return [event.payload.check, event.payload.details];
    case 'site.down':
      return [
        event.payload.url,
        `since ${event.payload.since}`,
        ...(event.payload.statusCode ? [`HTTP ${event.payload.statusCode}`] : []),
      ];
    case 'approval.requested':
      return [
        event.payload.approvalId,
        event.payload.department,
        event.payload.action,
        ...(event.payload.amountPaise !== null ? [formatRupees(event.payload.amountPaise)] : []),
        event.payload.reason,
      ];
    case 'approval.decided':
      return [
        event.payload.approvalId,
        event.payload.action,
        event.payload.decision,
        `by ${event.payload.decidedBy}`,
        ...(event.payload.reason ? [event.payload.reason] : []),
      ];
    case 'report.daily':
      return [
        event.payload.date,
        `${event.payload.orders} orders`,
        `revenue ${formatRupees(event.payload.revenuePaise)}`,
        `margin ${formatRupees(event.payload.grossMarginPaise)}`,
        `${event.payload.openTickets} open tickets`,
      ];
  }
}

function items(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

/** The #events line: sequence number first, so gaps and order are visible at a glance. */
export function eventsRoomLine(event: StoreEvent): string {
  return `#${event.seq} ${describeEvent(event)}`;
}
