import type { EventPayloads, EventType } from '@switch-gear/shared/events';
import type { Prisma } from '../generated/prisma/client';

/**
 * Writes one outbox event. Call it with the transaction client that makes the state change,
 * so the change and its event commit together. (The events API and webhooks are T-08.)
 */
export async function recordEvent<T extends EventType>(
  tx: Prisma.TransactionClient,
  event: { type: T; entityType: string; entityId: string; payload: EventPayloads[T]; at?: Date },
): Promise<void> {
  await tx.event.create({
    data: {
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload as Prisma.InputJsonValue,
      ...(event.at ? { createdAt: event.at } : {}),
    },
  });
}
