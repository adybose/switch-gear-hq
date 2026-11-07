import { gstTypeForState, sumPaise } from '@switch-gear/shared/money';
import {
  settlementNet,
  UNPAID_CANCEL_AFTER_MS,
  UNPAID_CANCEL_MIN_REAL_MS,
  unpaidDeadline,
  type PaymockCreatePayment,
  type PaymockPayment,
} from '@switch-gear/shared/paymock';
import { signWebhook, SIGNATURE_HEADER, webhookSecret } from '@switch-gear/shared/webhooks';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { recordEvent } from './events';
import { registerWebhookHandler, WebhookRejected } from './webhooks';

// PayMock on the store side: opening a payment for an order, the webhooks PayMock sends back
// (capture, failure, settlement) and cancelling orders that were never paid.
//
// A Payment row is written when PayMock reports an outcome, not when the pay page opens, so
// every row comes with its event (order.paid or payment.failed).

const paise = z.number().int().nonnegative();
const iso = z.iso.datetime({ offset: true });

const capturedData = z.object({
  gatewayRef: z.string().min(1).max(100),
  orderRef: z.string().min(1).max(64),
  orderNumber: z.string().min(1).max(40),
  amountPaise: paise,
  feePaise: paise,
  feeGstPaise: paise,
  capturedAt: iso,
});

const failedData = z.object({
  gatewayRef: z.string().min(1).max(100),
  orderRef: z.string().min(1).max(64),
  orderNumber: z.string().min(1).max(40),
  amountPaise: paise,
  reason: z.enum(['declined', 'expired']),
});

const settlementData = z.object({
  settlementRef: z.string().min(1).max(100),
  settledAt: iso,
  payments: z
    .array(z.object({ gatewayRef: z.string().min(1).max(100) }).loose())
    .min(1)
    .max(10_000),
});

function parseData<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new WebhookRejected('invalid_data', result.error.message);
  return result.data;
}

/**
 * The order must match both the number and the internal id PayMock was given, so a payment
 * opened before a demo reset can't land on a new order that reuses the number.
 */
function unknownOrder(data: { orderRef: string; orderNumber: string }): WebhookRejected {
  return new WebhookRejected('unknown_order', `No order ${data.orderNumber} (${data.orderRef}).`);
}

/** payment.captured: the order is paid. Refused if the order can't take this payment. */
export async function handleCaptured(
  tx: Prisma.TransactionClient,
  raw: Record<string, unknown>,
): Promise<void> {
  const data = parseData(capturedData, raw);
  const order = await tx.order.findFirst({
    where: { id: data.orderRef, number: data.orderNumber },
    include: { items: { select: { qty: true } } },
  });
  if (!order) throw unknownOrder(data);

  const existing = await tx.payment.findUnique({ where: { gatewayRef: data.gatewayRef } });
  if (existing?.status === 'captured' && existing.orderId === order.id) return; // replayed
  if (existing) {
    throw new WebhookRejected(
      'payment_conflict',
      `${data.gatewayRef} is already ${existing.status}.`,
    );
  }
  if (data.amountPaise !== order.totalPaise) {
    throw new WebhookRejected(
      'amount_mismatch',
      `${data.orderNumber} is ${order.totalPaise} paise, payment was ${data.amountPaise}.`,
    );
  }

  // Only a placed order can be paid; the status condition settles a race with the unpaid
  // timer, which moves placed orders the same way.
  const capturedAt = new Date(data.capturedAt);
  const { count } = await tx.order.updateMany({
    where: { id: order.id, status: 'placed' },
    data: { status: 'paid' },
  });
  if (count === 0) {
    throw new WebhookRejected('order_not_payable', `${data.orderNumber} is ${order.status}.`);
  }
  await tx.payment.create({
    data: {
      orderId: order.id,
      gatewayRef: data.gatewayRef,
      status: 'captured',
      amountPaise: data.amountPaise,
      feePaise: data.feePaise,
      feeGstPaise: data.feeGstPaise,
      capturedAt,
    },
  });
  await recordEvent(tx, {
    type: 'order.paid',
    entityType: 'order',
    entityId: order.number,
    payload: {
      orderNumber: order.number,
      totalPaise: order.totalPaise,
      itemCount: order.items.reduce((n, item) => n + item.qty, 0),
      gstType: gstTypeForState(order.shipState),
      paidAt: capturedAt.toISOString(),
    },
    at: capturedAt,
  });
}

/** payment.failed: record the failure and cancel the order if it is still waiting. */
export async function handleFailed(
  tx: Prisma.TransactionClient,
  raw: Record<string, unknown>,
  occurredAt: Date,
): Promise<void> {
  const data = parseData(failedData, raw);
  const order = await tx.order.findFirst({
    where: { id: data.orderRef, number: data.orderNumber },
  });
  if (!order) throw unknownOrder(data);

  const existing = await tx.payment.findUnique({ where: { gatewayRef: data.gatewayRef } });
  if (existing?.status === 'failed' && existing.orderId === order.id) return; // replayed
  if (existing) {
    throw new WebhookRejected(
      'payment_conflict',
      `${data.gatewayRef} is already ${existing.status}.`,
    );
  }

  await tx.payment.create({
    data: {
      orderId: order.id,
      gatewayRef: data.gatewayRef,
      status: 'failed',
      amountPaise: data.amountPaise,
      failureReason: data.reason,
    },
  });
  await tx.order.updateMany({
    where: { id: order.id, status: 'placed' },
    data: { status: 'cancelled' },
  });
  await recordEvent(tx, {
    type: 'payment.failed',
    entityType: 'order',
    entityId: order.number,
    payload: {
      orderNumber: order.number,
      gatewayRef: data.gatewayRef,
      amountPaise: data.amountPaise,
      reason: data.reason,
    },
    at: occurredAt,
  });
}

/**
 * settlement.processed: marks the batch's captured payments settled. Payments the store
 * doesn't know (e.g. from before a demo reset) or has already settled are skipped; amounts
 * come from the store's own records.
 */
export async function handleSettlement(
  tx: Prisma.TransactionClient,
  raw: Record<string, unknown>,
): Promise<void> {
  const data = parseData(settlementData, raw);
  const settledAt = new Date(data.settledAt);
  const refs = [...new Set(data.payments.map((p) => p.gatewayRef))];
  // Claim the payments in one conditional UPDATE. Row locks make a concurrent batch for the
  // same payment wait, then re-check `settledAt IS NULL` and claim nothing, so a payment is
  // settled (and counted in an event) exactly once.
  const due = await tx.$queryRaw<{ amountPaise: number; feePaise: number; feeGstPaise: number }[]>`
    UPDATE "Payment"
    SET "settledAt" = (${settledAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'),
        "settlementRef" = ${data.settlementRef}
    WHERE "gatewayRef" = ANY(${refs}) AND "status" = 'captured' AND "settledAt" IS NULL
    RETURNING "amountPaise", "feePaise", "feeGstPaise"`;
  if (due.length === 0) return;

  await recordEvent(tx, {
    type: 'settlement.received',
    entityType: 'settlement',
    entityId: data.settlementRef,
    payload: {
      settlementRef: data.settlementRef,
      amountPaise: sumPaise(...due.map((p) => settlementNet(p.amountPaise, p))),
      feePaise: sumPaise(...due.map((p) => p.feePaise + p.feeGstPaise)),
      paymentCount: due.length,
      settledAt: settledAt.toISOString(),
    },
    at: settledAt,
  });
}

/** Registers the PayMock webhook handlers (idempotent). The webhook route imports this module. */
export function registerPaymockHandlers(): void {
  registerWebhookHandler('paymock', 'payment.captured', (tx, e) => handleCaptured(tx, e.data));
  registerWebhookHandler('paymock', 'payment.failed', (tx, e) =>
    handleFailed(tx, e.data, new Date(e.occurredAt)),
  );
  registerWebhookHandler('paymock', 'settlement.processed', (tx, e) =>
    handleSettlement(tx, e.data),
  );
}
registerPaymockHandlers();

/**
 * Cancels orders still `placed` once both 30 business minutes (`now`, business time) and
 * 5 real minutes (`realNow`) have passed since checkout, one transaction per order, each with
 * an `order.cancelled` event. Returns the cancelled order numbers.
 */
export async function cancelUnpaidOrders(
  db: PrismaClient,
  now: Date,
  realNow: Date = new Date(),
): Promise<string[]> {
  const stale = await db.order.findMany({
    where: {
      status: 'placed',
      placedAt: { lte: new Date(now.getTime() - UNPAID_CANCEL_AFTER_MS) },
      createdAt: { lte: new Date(realNow.getTime() - UNPAID_CANCEL_MIN_REAL_MS) },
    },
    select: { id: true, number: true, totalPaise: true },
    orderBy: { placedAt: 'asc' },
    take: 200,
  });
  const cancelled: string[] = [];
  for (const order of stale) {
    const done = await db.$transaction(async (tx) => {
      // A capture may have landed since the read; only a still-placed order is cancelled.
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: 'placed' },
        data: { status: 'cancelled' },
      });
      if (count === 0) return false;
      await recordEvent(tx, {
        type: 'order.cancelled',
        entityType: 'order',
        entityId: order.number,
        payload: {
          orderNumber: order.number,
          totalPaise: order.totalPaise,
          reason: 'unpaid_timeout',
        },
        at: now,
      });
      return true;
    });
    if (done) cancelled.push(order.number);
  }
  return cancelled;
}

export class PaymentUnavailable extends Error {
  override name = 'PaymentUnavailable';
}

export interface OpenPaymentOptions {
  /** Business clock speed now, to express the 5-real-minute floor in business time. */
  speed: number;
  /** Sim base URL the store can reach (SIM_URL). */
  simUrl: string;
  /** Where PayMock sends the customer afterwards (the order page). */
  returnUrl: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Asks PayMock for the order's payment (PayMock reuses an open one) and returns the pay page
 * path on the sim. Returns null if the order isn't waiting for payment. Changes no state.
 */
export async function openPayment(
  db: PrismaClient,
  orderNumber: string,
  options: OpenPaymentOptions,
): Promise<PaymockPayment | null> {
  const order = await db.order.findUnique({
    where: { number: orderNumber },
    select: { id: true, status: true, totalPaise: true, placedAt: true },
  });
  if (!order || order.status !== 'placed') return null;

  const body: PaymockCreatePayment = {
    orderRef: order.id,
    orderNumber,
    amountPaise: order.totalPaise,
    returnUrl: options.returnUrl,
    expiresAt: unpaidDeadline(order.placedAt, options.speed).toISOString(),
  };
  const raw = JSON.stringify(body);
  const doFetch = options.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(new URL('/paymock/v1/payments', options.simUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signWebhook(webhookSecret('paymock'), raw),
      },
      body: raw,
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    throw new PaymentUnavailable(`PayMock unreachable: ${String(err)}`);
  }
  if (!res.ok) throw new PaymentUnavailable(`PayMock answered ${res.status}`);
  const payment = (await res.json()) as PaymockPayment;
  if (typeof payment?.payPath !== 'string' || !payment.payPath.startsWith('/paymock/pay/')) {
    throw new PaymentUnavailable('PayMock sent an unexpected response');
  }
  return payment;
}
