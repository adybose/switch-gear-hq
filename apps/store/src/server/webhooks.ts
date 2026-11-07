import type { WebhookEnvelope, WebhookPartner } from '@switch-gear/shared/webhooks';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

// Partner webhooks. The route verifies the signature; this module dedupes by eventId and
// runs the partner's handler in the same transaction as the receipt, so a webhook's effects
// are applied exactly once even if the partner retries.

export const envelopeSchema = z.object({
  eventId: z.string().trim().min(1).max(100),
  type: z.string().trim().min(1).max(100),
  occurredAt: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
});

/**
 * Thrown by a handler for a webhook the store refuses for good (unknown order, wrong amount,
 * order no longer payable). Nothing is recorded, and the route answers 409 so the partner
 * stops retrying.
 */
export class WebhookRejected extends Error {
  override name = 'WebhookRejected';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Applies one webhook's effects (state change + outbox event) inside `tx`. */
export type WebhookHandler = (
  tx: Prisma.TransactionClient,
  envelope: WebhookEnvelope,
) => Promise<void>;

/** Handlers by partner and event type. Partners register theirs from T-07 on. */
const handlers: Record<WebhookPartner, Map<string, WebhookHandler>> = {
  paymock: new Map(),
  printhub: new Map(),
  shipfast: new Map(),
};

export function registerWebhookHandler(
  partner: WebhookPartner,
  type: string,
  handler: WebhookHandler,
): void {
  handlers[partner].set(type, handler);
}

/** For tests. */
export function clearWebhookHandlers(): void {
  for (const map of Object.values(handlers)) map.clear();
}

export type WebhookResult = 'processed' | 'ignored' | 'duplicate';

/**
 * Records the receipt and runs the handler in one transaction. A repeated eventId is
 * reported as `duplicate` and changes nothing: the receipt insert is ON CONFLICT DO NOTHING,
 * and a copy racing an in-flight one waits for it to commit, then finds the row. Types with
 * no handler are acknowledged as `ignored`. A failing handler rolls everything back,
 * receipt included, so the partner's retry is processed fresh.
 */
export async function processWebhook(
  db: PrismaClient,
  partner: WebhookPartner,
  envelope: WebhookEnvelope,
): Promise<WebhookResult> {
  const handler = handlers[partner].get(envelope.type);
  const outcome = handler ? 'processed' : 'ignored';
  return db.$transaction(async (tx) => {
    const { count } = await tx.webhookReceipt.createMany({
      data: [{ partner, eventId: envelope.eventId, type: envelope.type, outcome }],
      skipDuplicates: true,
    });
    if (count === 0) return 'duplicate';
    if (handler) await handler(tx, envelope);
    return outcome;
  });
}
