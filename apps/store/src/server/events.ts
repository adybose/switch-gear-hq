import type { EventPayloads, EventType, StoreEvent } from '@switch-gear/shared/events';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

/** Arbitrary constant naming the outbox write lock (pg_advisory_xact_lock key). */
const OUTBOX_LOCK_KEY = 7_316_001;

/**
 * Writes one outbox event. Call it with the transaction client that makes the state change,
 * so the change and its event commit together. This is the only way events are written.
 *
 * It takes a transaction-scoped lock first, so event-writing transactions run one at a time
 * and `seq` order equals commit order. Without that, a slow transaction could commit seq 41
 * after a reader had already moved past seq 42, and the reader would never see it.
 */
export async function recordEvent<T extends EventType>(
  tx: Prisma.TransactionClient,
  event: { type: T; entityType: string; entityId: string; payload: EventPayloads[T]; at?: Date },
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OUTBOX_LOCK_KEY})`;
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

export const EVENTS_DEFAULT_LIMIT = 100;
export const EVENTS_MAX_LIMIT = 500;

/** Events with seq > `after`, oldest first. Page by passing the last seq back as `after`. */
export async function listEvents(
  db: PrismaClient,
  after: number,
  limit: number = EVENTS_DEFAULT_LIMIT,
): Promise<StoreEvent[]> {
  const rows = await db.event.findMany({
    where: { seq: { gt: after } },
    orderBy: { seq: 'asc' },
    take: Math.min(Math.max(limit, 1), EVENTS_MAX_LIMIT),
  });
  return rows.map(
    (row) =>
      ({
        seq: row.seq,
        type: row.type,
        entityType: row.entityType,
        entityId: row.entityId,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      }) as StoreEvent,
  );
}
