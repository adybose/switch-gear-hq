import { formatRupees } from '@switch-gear/shared/money';
import {
  gatewayFee,
  PENDING_RESOLVE_WITHIN_MS,
  SETTLEMENT_AFTER_MS,
  type GatewayFee,
  type PaymockCreatePayment,
  type PaymockFailureReason,
  type PaymockPayment,
  type PaymockPaymentStatus,
  type PaymockWebhookData,
  type PaymockWebhookType,
} from '@switch-gear/shared/paymock';
import {
  SIGNATURE_HEADER,
  signWebhook,
  verifyWebhook,
  type WebhookEnvelope,
} from '@switch-gear/shared/webhooks';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { realDelayMs, type SimClock } from './clock';

// PayMock, the simulated payment gateway. The store opens a payment (signed call), the
// customer picks Success / Failure / Pending on the pay page, and PayMock reports the outcome
// to the store with signed webhooks. Captured payments settle in batches at T+2.
// State is in memory: a sim restart forgets open payments, and the store's unpaid timer
// cancels those orders.

export interface PaymockOptions {
  clock: SimClock;
  /** Store base URL for webhooks (STORE_URL). */
  storeUrl: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  /** 0..1; picks when a pending payment resolves. */
  random?: () => number;
  /** Runs `fn` after `ms` real milliseconds. */
  schedule?: (fn: () => void, ms: number) => void;
  /** Real ms between webhook attempts after the first; a 4xx answer stops retrying. */
  retryDelaysMs?: number[];
  /** Real ms between settlement runs; 0 turns the timer off (tests call settleDue()). */
  settleEveryMs?: number;
}

interface Payment {
  gatewayRef: string;
  orderRef: string;
  orderNumber: string;
  amountPaise: number;
  returnUrl: string;
  expiresAt: Date;
  status: PaymockPaymentStatus;
  capturedAt?: Date;
  fee?: GatewayFee;
  settlementRef?: string;
}

export type Outcome = 'success' | 'failure' | 'pending';
const OUTCOMES: readonly Outcome[] = ['success', 'failure', 'pending'];

export interface Paymock {
  /** For tests and the order generator (T-15). */
  get(gatewayRef: string): Readonly<Payment> | undefined;
  choose(gatewayRef: string, outcome: Outcome): Promise<Readonly<Payment> | undefined>;
  resolvePending(gatewayRef: string): Promise<void>;
  settleDue(): Promise<string | null>;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function isCreateBody(body: unknown): body is PaymockCreatePayment {
  if (body === null || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.orderRef === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(b.orderRef) &&
    typeof b.orderNumber === 'string' &&
    /^ORD-\d{1,12}$/.test(b.orderNumber) &&
    Number.isSafeInteger(b.amountPaise) &&
    (b.amountPaise as number) > 0 &&
    typeof b.returnUrl === 'string' &&
    /^https?:\/\//.test(b.returnUrl) &&
    typeof b.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(b.expiresAt))
  );
}

export function registerPaymock(app: FastifyInstance, options: PaymockOptions): Paymock {
  const { clock } = options;
  const doFetch = options.fetch ?? globalThis.fetch;
  const random = options.random ?? Math.random;
  const schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms).unref());
  const retryDelays = options.retryDelaysMs ?? [1000, 5000, 15000, 60000];
  const payments = new Map<string, Payment>();

  /**
   * Sends one webhook and resolves with the first attempt's HTTP status (0 if the store
   * couldn't be reached), so a customer's click never waits on retries. Network errors and
   * 5xx are retried in the background with the same eventId; `onFinal` gets the status of the
   * attempt that ended it.
   */
  function deliver<T extends PaymockWebhookType>(
    type: T,
    data: PaymockWebhookData[T],
    onFinal: (status: number) => void = () => {},
  ): Promise<number> {
    const envelope: WebhookEnvelope<PaymockWebhookData[T]> = {
      eventId: `evt_${randomUUID()}`,
      type,
      occurredAt: clock.now().toISOString(),
      data,
    };
    const raw = JSON.stringify(envelope);

    const attempt = async (n: number): Promise<number> => {
      const status = await doFetch(new URL('/api/v1/webhooks/paymock', options.storeUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signWebhook(options.secret, raw),
        },
        body: raw,
        signal: AbortSignal.timeout(5000),
      }).then(
        (res) => res.status,
        () => 0,
      );
      if ((status === 0 || status >= 500) && n < retryDelays.length) {
        schedule(() => void attempt(n + 1), retryDelays[n]!);
        return status;
      }
      if (status < 200 || status >= 300) {
        app.log.warn({ type, eventId: envelope.eventId, status }, 'paymock webhook not accepted');
      }
      onFinal(status);
      return status;
    };
    return attempt(0);
  }

  async function capture(payment: Payment): Promise<void> {
    if (clock.now() > payment.expiresAt) return fail(payment, 'expired');
    payment.status = 'captured';
    payment.capturedAt = clock.now();
    payment.fee = gatewayFee(payment.amountPaise);
    await deliver(
      'payment.captured',
      {
        gatewayRef: payment.gatewayRef,
        orderRef: payment.orderRef,
        orderNumber: payment.orderNumber,
        amountPaise: payment.amountPaise,
        ...payment.fee,
        capturedAt: payment.capturedAt.toISOString(),
      },
      (status) => {
        // The store refused it for good (e.g. the order was cancelled): give the money back.
        if (status >= 400 && status < 500) payment.status = 'voided';
      },
    );
  }

  async function fail(payment: Payment, reason: PaymockFailureReason): Promise<void> {
    payment.status = 'failed';
    await deliver('payment.failed', {
      gatewayRef: payment.gatewayRef,
      orderRef: payment.orderRef,
      orderNumber: payment.orderNumber,
      amountPaise: payment.amountPaise,
      reason,
    });
  }

  async function resolvePending(gatewayRef: string): Promise<void> {
    const payment = payments.get(gatewayRef);
    if (payment?.status === 'pending') await capture(payment);
  }

  async function choose(gatewayRef: string, outcome: Outcome) {
    const payment = payments.get(gatewayRef);
    if (!payment || payment.status !== 'created') return payment;
    if (outcome === 'success') await capture(payment);
    else if (outcome === 'failure') await fail(payment, 'declined');
    else if (clock.now() > payment.expiresAt) await fail(payment, 'expired');
    else {
      // Pending resolves to success some time within 5 business minutes.
      payment.status = 'pending';
      const businessMs = Math.round((0.1 + 0.9 * random()) * PENDING_RESOLVE_WITHIN_MS);
      schedule(() => void resolvePending(gatewayRef), realDelayMs(clock, businessMs));
    }
    return payment;
  }

  /** Settles every payment captured at least two business days ago, as one batch. */
  async function settleDue(): Promise<string | null> {
    const cutoff = clock.now().getTime() - SETTLEMENT_AFTER_MS;
    const due = [...payments.values()].filter(
      (p) => p.status === 'captured' && !p.settlementRef && p.capturedAt!.getTime() <= cutoff,
    );
    if (due.length === 0) return null;
    const settlementRef = `stl_${randomBytes(6).toString('hex')}`;
    for (const p of due) p.settlementRef = settlementRef;
    await deliver('settlement.processed', {
      settlementRef,
      settledAt: clock.now().toISOString(),
      payments: due.map((p) => ({
        gatewayRef: p.gatewayRef,
        amountPaise: p.amountPaise,
        ...p.fee!,
      })),
    });
    return settlementRef;
  }

  app.register(async (scope) => {
    // The create call is signed over the exact bytes, so keep the raw body.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body === '' ? {} : JSON.parse(body as string));
      } catch {
        done(null, undefined);
      }
    });
    // The pay page's buttons post empty forms.
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, _body, done) => done(null, {}),
    );

    scope.post('/paymock/v1/payments', async (req, reply) => {
      const raw = (req as { rawBody?: string }).rawBody ?? '';
      const header = req.headers[SIGNATURE_HEADER.toLowerCase()];
      if (!verifyWebhook(options.secret, raw, typeof header === 'string' ? header : null)) {
        return reply.code(401).send({ error: 'bad_signature' });
      }
      if (!isCreateBody(req.body)) return reply.code(422).send({ error: 'validation_failed' });
      const body = req.body;

      // One open payment per order: a second "Pay now" reuses it. Keyed on orderRef, so an
      // order number reused after a demo reset gets a fresh payment.
      let payment = [...payments.values()].find(
        (p) =>
          p.orderRef === body.orderRef &&
          (p.status === 'created' || p.status === 'pending' || p.status === 'captured'),
      );
      if (!payment) {
        payment = {
          gatewayRef: `pay_${randomBytes(8).toString('hex')}`,
          orderRef: body.orderRef,
          orderNumber: body.orderNumber,
          amountPaise: body.amountPaise,
          returnUrl: body.returnUrl,
          expiresAt: new Date(body.expiresAt),
          status: 'created',
        };
        payments.set(payment.gatewayRef, payment);
      }
      const result: PaymockPayment = {
        gatewayRef: payment.gatewayRef,
        status: payment.status,
        payPath: `/paymock/pay/${payment.gatewayRef}`,
      };
      return reply.code(200).send(result);
    });

    scope.get<{ Params: { ref: string } }>('/paymock/pay/:ref', async (req, reply) => {
      const payment = payments.get(req.params.ref);
      if (!payment) return reply.code(404).type('text/html').send(page('Payment not found', ''));
      return reply.type('text/html').send(payPage(payment));
    });

    scope.post<{ Params: { ref: string; outcome: string } }>(
      '/paymock/pay/:ref/:outcome',
      async (req, reply) => {
        const outcome = req.params.outcome as Outcome;
        if (!OUTCOMES.includes(outcome)) return reply.code(404).send({ error: 'not_found' });
        const payment = await choose(req.params.ref, outcome);
        if (!payment) return reply.code(404).send({ error: 'not_found' });
        return reply.redirect(payment.returnUrl, 303);
      },
    );
  });

  if (options.settleEveryMs) {
    const timer = setInterval(() => void settleDue(), options.settleEveryMs);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  return { get: (ref) => payments.get(ref), choose, resolvePending, settleDue };
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · PayMock</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f5f5f5;color:#171717}
.banner{background:#171717;color:#fff;text-align:center;font-size:13px;padding:8px}
main{max-width:420px;margin:32px auto;padding:24px;background:#fff;border-radius:12px}
h1{font-size:22px;margin:0 0 4px}.amount{font-size:32px;font-weight:700;margin:16px 0}
form{margin:0}button{display:block;width:100%;font-size:16px;padding:14px;margin-top:12px;border:0;border-radius:8px;cursor:pointer}
.success{background:#15803d;color:#fff}.failure{background:#b91c1c;color:#fff}.pending{background:#e5e5e5}
p{color:#525252;font-size:14px}
</style></head><body>
<div class="banner">PayMock demo gateway. No real money moves.</div>
<main>${body}</main></body></html>`;
}

function payPage(p: Payment): string {
  const head = `<h1>Pay Switch Gear</h1><p>Order ${escapeHtml(p.orderNumber)}</p>
<div class="amount" data-testid="paymock-amount">${formatRupees(p.amountPaise)}</div>`;
  if (p.status !== 'created') {
    const text: Record<PaymockPaymentStatus, string> = {
      created: '',
      pending: 'This payment is pending. It will complete within 5 minutes.',
      captured: 'This payment is complete.',
      failed: 'This payment failed.',
      voided: 'This payment was cancelled and nothing was charged.',
    };
    return page(
      'Payment',
      `${head}<p>${text[p.status]}</p>
<p><a href="${escapeHtml(p.returnUrl)}">Back to your order</a></p>`,
    );
  }
  const button = (outcome: Outcome, label: string) =>
    `<form method="post" action="/paymock/pay/${p.gatewayRef}/${outcome}"><button class="${outcome}" type="submit">${label}</button></form>`;
  return page(
    'Pay',
    `${head}<p>Choose how this test payment should go.</p>
${button('success', 'Success')}${button('failure', 'Failure')}${button('pending', 'Pending')}`,
  );
}
