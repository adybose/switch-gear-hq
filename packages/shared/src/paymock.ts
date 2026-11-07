// PayMock: the simulated payment gateway (apps/sim). This file is the contract between the
// store and the sim: the fee rule, timings, and the shapes of the calls in both directions.
//
// Store → sim  POST /paymock/v1/payments, signed like a webhook (X-SG-Signature, PayMock secret)
// Sim → store  POST /api/v1/webhooks/paymock with one of the PaymockWebhook types below

import { percentOf, sumPaise } from './money';

/** Gateway fee: 2% of the payment, plus 18% GST on that fee (spec §6). */
export const PAYMOCK_FEE_PERCENT = 2;
export const PAYMOCK_FEE_GST_PERCENT = 18;

export interface GatewayFee {
  /** The 2% fee, before GST. */
  feePaise: number;
  /** 18% GST on the fee (input credit for the store). */
  feeGstPaise: number;
}

export function gatewayFee(amountPaise: number): GatewayFee {
  const feePaise = percentOf(amountPaise, PAYMOCK_FEE_PERCENT);
  return { feePaise, feeGstPaise: percentOf(feePaise, PAYMOCK_FEE_GST_PERCENT) };
}

/** What the merchant receives for a payment at settlement. */
export function settlementNet(amountPaise: number, fee: GatewayFee): number {
  return amountPaise - sumPaise(fee.feePaise, fee.feeGstPaise);
}

const MINUTE = 60_000;

/**
 * Unpaid orders are cancelled 30 business minutes after they were placed, but never sooner
 * than 5 real minutes: a person is paying, and at demo speed 30 business minutes is seconds.
 */
export const UNPAID_CANCEL_AFTER_MS = 30 * MINUTE;
export const UNPAID_CANCEL_MIN_REAL_MS = 5 * MINUTE;

/**
 * True once an unpaid order is past both limits: 30 business minutes after `placedAt` (business
 * time) and 5 real minutes after `createdAt` (real time). The store's timer and PayMock both use
 * this, each with its own clocks, so neither needs to know the clock speed.
 */
export function isUnpaidExpired(
  deadline: { expiresAt: Date; minExpiresAt: Date },
  businessNow: Date,
  realNow: Date,
): boolean {
  return businessNow >= deadline.expiresAt && realNow >= deadline.minExpiresAt;
}
/** A "pending" payment resolves within this long (business time). */
export const PENDING_RESOLVE_WITHIN_MS = 5 * MINUTE;
/** Captured payments settle T+2 (business time). */
export const SETTLEMENT_AFTER_MS = 2 * 24 * 60 * MINUTE;

/** Body of POST /paymock/v1/payments. */
export interface PaymockCreatePayment {
  /**
   * The store's internal order id. Unlike the order number it is never reused (a demo reset
   * restarts numbering), so PayMock keys payments on it and echoes it in every webhook.
   */
  orderRef: string;
  orderNumber: string;
  amountPaise: number;
  /** Where the pay page sends the customer back to. */
  returnUrl: string;
  /**
   * The order's unpaid deadline: business time `placedAt` + 30 minutes (`expiresAt`) and real
   * time order creation + 5 minutes (`minExpiresAt`). Once both have passed, the payment can't
   * be captured; the store cancels the order at the same point.
   */
  expiresAt: string;
  minExpiresAt: string;
}

export type PaymockPaymentStatus = 'created' | 'pending' | 'captured' | 'failed' | 'voided';

/** Response of POST /paymock/v1/payments. Repeats for the same open order return the same payment. */
export interface PaymockPayment {
  gatewayRef: string;
  status: PaymockPaymentStatus;
  /** Path of the pay page on the sim, e.g. `/paymock/pay/pay_abc`. */
  payPath: string;
}

export type PaymockFailureReason = 'declined' | 'expired';

export interface PaymockWebhookData {
  'payment.captured': {
    gatewayRef: string;
    orderRef: string;
    orderNumber: string;
    amountPaise: number;
    feePaise: number;
    feeGstPaise: number;
    capturedAt: string;
  };
  'payment.failed': {
    gatewayRef: string;
    orderRef: string;
    orderNumber: string;
    amountPaise: number;
    reason: PaymockFailureReason;
  };
  'settlement.processed': {
    settlementRef: string;
    settledAt: string;
    payments: {
      gatewayRef: string;
      amountPaise: number;
      feePaise: number;
      feeGstPaise: number;
    }[];
  };
}

export type PaymockWebhookType = keyof PaymockWebhookData;
