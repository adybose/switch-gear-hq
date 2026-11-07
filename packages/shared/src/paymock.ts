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

/** Unpaid orders are cancelled this long (business time) after they were placed. */
export const UNPAID_CANCEL_AFTER_MS = 30 * MINUTE;
/** A "pending" payment resolves within this long (business time). */
export const PENDING_RESOLVE_WITHIN_MS = 5 * MINUTE;
/** Captured payments settle T+2 (business time). */
export const SETTLEMENT_AFTER_MS = 2 * 24 * 60 * MINUTE;

/** Body of POST /paymock/v1/payments. */
export interface PaymockCreatePayment {
  orderNumber: string;
  amountPaise: number;
  /** Where the pay page sends the customer back to. */
  returnUrl: string;
  /** After this the payment can't be captured (the store cancels the order). */
  expiresAt: string;
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
    orderNumber: string;
    amountPaise: number;
    feePaise: number;
    feeGstPaise: number;
    capturedAt: string;
  };
  'payment.failed': {
    gatewayRef: string;
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
