// Partner webhooks (sim → store): `X-SG-Signature: sha256=<hex HMAC of the raw body>`
// with a per-partner secret. Node-only (node:crypto), so it is not re-exported from the
// package index, which client components may import. Use `@switch-gear/shared/webhooks`.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookPartner = 'paymock' | 'printhub' | 'shipfast';

export const WEBHOOK_PARTNERS: readonly WebhookPartner[] = ['paymock', 'printhub', 'shipfast'];

export const SIGNATURE_HEADER = 'X-SG-Signature';

/** Every partner webhook body has this shape; `data` depends on `type`. */
export interface WebhookEnvelope<T = Record<string, unknown>> {
  /** Unique per delivery attempt group; the store ignores repeats. */
  eventId: string;
  /** e.g. `payment.captured`, `printjob.packed`. */
  type: string;
  occurredAt: string;
  data: T;
}

/** Env var holding each partner's secret (test values in .env.example). */
export function webhookSecretEnv(partner: WebhookPartner): string {
  return `${partner.toUpperCase()}_WEBHOOK_SECRET`;
}

// Test-only fallbacks, matching .env.example, so a fresh clone works without a .env.
const TEST_SECRETS: Record<WebhookPartner, string> = {
  paymock: 'test_paymock_secret',
  printhub: 'test_printhub_secret',
  shipfast: 'test_shipfast_secret',
};

/** The partner's secret from the environment, or its test value from .env.example. */
export function webhookSecret(partner: WebhookPartner): string {
  return process.env[webhookSecretEnv(partner)] || TEST_SECRETS[partner];
}

/** Header value for a raw body: `sha256=<hex>`. */
export function signWebhook(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

/** Constant-time check of a header value against the raw body. */
export function verifyWebhook(
  secret: string,
  rawBody: string,
  header: string | null | undefined,
): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(signWebhook(secret, rawBody), 'utf8');
  const given = Buffer.from(header.trim(), 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
