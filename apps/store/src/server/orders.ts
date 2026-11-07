import type { PrismaClient } from '../generated/prisma/client';
import { recordEvent } from './events';

export class OrderError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const detail = {
  items: { include: { variant: { select: { sku: true } } }, orderBy: { id: 'asc' as const } },
  printJobs: { orderBy: { attempt: 'desc' as const }, take: 1 },
  shipments: { orderBy: { sequence: 'desc' as const }, take: 1 },
  invoice: { select: { number: true } },
};

type OrderRow = Awaited<ReturnType<typeof findRows>>[number];
const findRows = (db: PrismaClient, where: object, take?: number) =>
  db.order.findMany({
    where,
    include: detail,
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    ...(take ? { take } : {}),
  });

async function present(db: PrismaClient, rows: OrderRow[]) {
  const events = rows.length
    ? await db.event.findMany({
        where: {
          entityType: 'order',
          entityId: { in: rows.map((o) => o.number) },
          type: { in: ['order.placed', 'order.paid', 'order.cancelled'] },
        },
        orderBy: { seq: 'asc' },
        select: { type: true, entityId: true, createdAt: true },
      })
    : [];
  return rows.map((o) => ({
    number: o.number,
    status: o.status,
    items: o.items.map((i) => ({
      sku: i.variant.sku,
      qty: i.qty,
      unitPricePaise: i.unitPricePaise,
    })),
    subtotalPaise: o.subtotalPaise,
    discountPaise: o.discountPaise,
    shippingPaise: o.shippingPaise,
    taxPaise: o.taxPaise,
    totalPaise: o.totalPaise,
    timeline: events
      .filter((e) => e.entityId === o.number)
      .map((e) => ({ status: e.type.replace('order.', ''), at: e.createdAt.toISOString() })),
    printJob: o.printJobs[0]
      ? {
          partnerRef: o.printJobs[0].partnerRef,
          status: o.printJobs[0].status,
          attempt: o.printJobs[0].attempt,
        }
      : null,
    shipment: o.shipments[0]
      ? {
          awb: o.shipments[0].awb,
          status: o.shipments[0].status,
          sequence: o.shipments[0].sequence,
        }
      : null,
    invoiceNumber: o.invoice?.number ?? null,
  }));
}

/** Full order records for staff, newest first. Customer contact details are not included. */
export async function listOrders(db: PrismaClient, status?: OrderRow['status'], limit = 50) {
  return present(db, await findRows(db, status ? { status } : {}, limit));
}

export async function getOrder(db: PrismaClient, number: string) {
  const [row] = await findRows(db, { number }, 1);
  return row ? (await present(db, [row]))[0]! : null;
}

/**
 * Cancels an order before printing starts. Only `placed`, or `paid` with no print job, can be
 * cancelled. The order row is locked so a concurrent print submission or second cancel loses.
 * A paid order also gets a full-amount Refund (`requested`) and `refund.requested`; the money
 * moves when refunds are processed (T-18). A `placed` order has taken no money.
 */
export async function cancelOrder(db: PrismaClient, number: string, now: Date) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE number = ${number} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { number },
      include: { _count: { select: { printJobs: true } } },
    });
    if (!order) throw new OrderError('not_found', 404, 'Order not found.');
    const cancellable =
      order.status === 'placed' || (order.status === 'paid' && order._count.printJobs === 0);
    if (!cancellable)
      throw new OrderError(
        'order_not_cancellable',
        409,
        `A ${order.status} order cannot be cancelled; only placed, or paid before printing.`,
      );
    await tx.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    await recordEvent(tx, {
      type: 'order.cancelled',
      entityType: 'order',
      entityId: number,
      payload: { orderNumber: number, totalPaise: order.totalPaise, reason: 'requested' },
      at: now,
    });
    if (order.status === 'paid') {
      const refund = await tx.refund.create({
        data: { orderId: order.id, amountPaise: order.totalPaise, reason: 'order_cancelled' },
      });
      await recordEvent(tx, {
        type: 'refund.requested',
        entityType: 'refund',
        entityId: refund.id,
        payload: {
          orderNumber: number,
          refundId: refund.id,
          amountPaise: order.totalPaise,
          reason: 'order_cancelled',
          approvalId: null,
        },
        at: now,
      });
    }
  });
  return (await getOrder(db, number))!;
}
