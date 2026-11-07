import type { PrismaClient } from '../generated/prisma/client';

/** Customer-facing wording for the events that belong on a tracking timeline. */
const TIMELINE_LABELS: Record<string, string> = {
  'order.placed': 'Order placed',
  'order.paid': 'Payment received',
  'payment.failed': 'Payment failed',
  'order.cancelled': 'Order cancelled',
  'shipment.status': 'Shipment status updated',
  'shipment.delivered': 'Delivered',
  'shipment.failed': 'Delivery attempt failed',
  'shipment.rto': 'Returning to us',
};

const SHIPMENT_LABELS: Record<string, string> = {
  pickup_scheduled: 'Shipment booked',
  picked_up: 'Picked up by courier',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
};

export interface TimelineEntry {
  type: string;
  label: string;
  at: string;
}

export interface TrackedOrder {
  number: string;
  status: string;
  placedAt: string;
  timeline: TimelineEntry[];
  awb: string | null;
  invoiceNumber: string | null;
}

/**
 * Looks an order up by number AND email (case-insensitive). A wrong pair returns null, the
 * same as a missing order, so the form cannot be used to find out which numbers exist.
 */
export async function trackOrder(
  db: PrismaClient,
  orderNumber: string,
  email: string,
): Promise<TrackedOrder | null> {
  const order = await db.order.findUnique({
    where: { number: orderNumber.trim() },
    select: {
      id: true,
      number: true,
      status: true,
      placedAt: true,
      customer: { select: { email: true } },
      shipments: {
        select: { awb: true },
        where: { awb: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!order || order.customer.email.toLowerCase() !== email.trim().toLowerCase()) return null;

  const [events, invoice] = await Promise.all([
    db.event.findMany({
      where: {
        type: { in: Object.keys(TIMELINE_LABELS) },
        OR: [
          { entityType: 'order', entityId: order.number },
          { payload: { path: ['orderNumber'], equals: order.number } },
        ],
      },
      orderBy: { seq: 'asc' },
      select: { type: true, createdAt: true, payload: true },
    }),
    db.customerInvoice.findUnique({ where: { orderId: order.id }, select: { number: true } }),
  ]);

  return {
    number: order.number,
    status: order.status,
    placedAt: order.placedAt.toISOString(),
    timeline: events.flatMap((e) => {
      const payload = e.payload as { status?: string; reason?: string };
      const label =
        e.type === 'shipment.status'
          ? SHIPMENT_LABELS[payload.status ?? '']
          : e.type === 'shipment.failed' && payload.reason === 'lost'
            ? 'Parcel lost'
            : TIMELINE_LABELS[e.type];
      return label ? [{ type: e.type, label, at: e.createdAt.toISOString() }] : [];
    }),
    awb: order.shipments[0]?.awb ?? null,
    invoiceNumber: invoice?.number ?? null,
  };
}
