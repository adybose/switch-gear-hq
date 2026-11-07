import {
  PRINT_COST,
  PRINT_SLA_MS,
  printAcceptedSchema,
  printCreateSchema,
  printWebhookDataSchema,
  type PrintCreate,
  type PrintStatus,
} from '@switch-gear/shared/printhub';
import { SIGNATURE_HEADER, signWebhook, webhookSecret } from '@switch-gear/shared/webhooks';
import type { Prisma, PrismaClient, PrintJob } from '../generated/prisma/client';
import { recordEvent } from './events';
import { registerWebhookHandler, WebhookRejected } from './webhooks';

export class PrintJobError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface CreatePrintOptions {
  simUrl: string;
  now: Date;
  reprintId?: string;
  fetch?: typeof globalThis.fetch;
}

/** Order lock serializes print submissions, reprints and status callbacks. */
export async function createPrintJob(
  db: PrismaClient,
  orderNumber: string,
  options: CreatePrintOptions,
): Promise<PrintJob> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE number = ${orderNumber} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { number: orderNumber },
        include: {
          items: { include: { variant: { include: { product: true } } } },
          printJobs: { orderBy: { attempt: 'desc' } },
        },
      });
      if (!order) throw new PrintJobError('not_found', 404, 'Order not found.');
      const previous = order.printJobs[0];
      if (options.reprintId) {
        if (
          !previous ||
          previous.id !== options.reprintId ||
          previous.status !== 'misprint' ||
          order.status !== 'printing'
        )
          throw new PrintJobError(
            'not_reprintable',
            409,
            'Only the latest misprint can be reprinted.',
          );
      } else if (order.status !== 'paid' || previous)
        throw new PrintJobError(
          'order_not_printable',
          409,
          'Printing requires a paid order without an existing job.',
        );
      const attempt = (previous?.attempt ?? 0) + 1;
      const input: PrintCreate = printCreateSchema.parse({
        orderRef: order.id,
        orderNumber,
        attempt,
        ...(options.reprintId ? { reprintOf: previous!.partnerRef } : {}),
        items: order.items.map((item) => ({
          sku: item.variant.sku,
          fit: item.variant.fit,
          colour: item.variant.colour,
          size: item.variant.size,
          qty: item.qty,
          artworkUrl: new URL(
            item.variant.product.artworkUrl,
            process.env.STORE_URL ?? 'http://localhost:3000',
          ).href,
        })),
        shipTo: {
          name: order.shipName,
          phone: order.shipPhone,
          address: order.shipAddress,
          city: order.shipCity,
          state: order.shipState,
          pincode: order.shipPincode,
        },
      });
      const raw = JSON.stringify(input);
      let accepted;
      try {
        const res = await (options.fetch ?? globalThis.fetch)(
          new URL('/printhub/v1/print-jobs', options.simUrl),
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              [SIGNATURE_HEADER]: signWebhook(webhookSecret('printhub'), raw),
            },
            body: raw,
            signal: AbortSignal.timeout(3000),
          },
        );
        if (!res.ok) throw new Error(`PrintHub answered ${res.status}`);
        accepted = printAcceptedSchema.parse(await res.json());
        const expected = options.reprintId
          ? 0
          : input.items.reduce((n, item) => n + PRINT_COST[item.fit] * item.qty, 0);
        if (accepted.costPaise !== expected) throw new Error('PrintHub cost mismatch');
      } catch (err) {
        throw new PrintJobError('printhub_unavailable', 503, String(err));
      }
      const acceptedAt = new Date(accepted.acceptedAt);
      const job = await tx.printJob.create({
        data: {
          orderId: order.id,
          partnerRef: accepted.partnerRef,
          status: 'received',
          attempt,
          costPaise: accepted.costPaise,
          acceptedAt,
          dueAt: new Date(acceptedAt.getTime() + PRINT_SLA_MS),
        },
      });
      await tx.order.update({ where: { id: order.id }, data: { status: 'printing' } });
      await recordStatus(tx, job, orderNumber, options.now);
      return job;
    },
    { timeout: 15000, maxWait: 10000 },
  );
}

async function recordStatus(
  tx: Prisma.TransactionClient,
  job: PrintJob,
  orderNumber: string,
  at: Date,
): Promise<void> {
  await recordEvent(tx, {
    type: 'printjob.status',
    entityType: 'printjob',
    entityId: job.id,
    payload: {
      orderNumber,
      partnerRef: job.partnerRef!,
      attempt: job.attempt,
      status: job.status,
      costPaise: job.costPaise,
    },
    at,
  });
}
const NEXT: Record<PrintStatus, readonly PrintStatus[]> = {
  received: ['in_production', 'artwork_rejected', 'blank_out_of_stock'],
  in_production: ['quality_check'],
  quality_check: ['packed', 'misprint'],
  packed: ['handed_over'],
  handed_over: [],
  misprint: [],
  artwork_rejected: [],
  blank_out_of_stock: [],
};
const ACTIVE: PrintStatus[] = ['received', 'in_production', 'quality_check', 'packed'];
const RANK: readonly PrintStatus[] = [
  'received',
  'in_production',
  'quality_check',
  'packed',
  'handed_over',
];

async function reportLate(
  tx: Prisma.TransactionClient,
  job: PrintJob,
  orderNumber: string,
  now: Date,
): Promise<boolean> {
  if (!ACTIVE.includes(job.status) || job.dueAt >= now) return false;
  const { count } = await tx.printJob.updateMany({
    where: { id: job.id, lateReportedAt: null },
    data: { lateReportedAt: now },
  });
  if (!count) return false;
  await recordEvent(tx, {
    type: 'printjob.late',
    entityType: 'printjob',
    entityId: job.id,
    payload: {
      orderNumber,
      partnerRef: job.partnerRef!,
      status: job.status,
      dueAt: job.dueAt.toISOString(),
    },
    at: now,
  });
  return true;
}

export async function handlePrintStatus(
  tx: Prisma.TransactionClient,
  raw: Record<string, unknown>,
  at: Date,
): Promise<void> {
  const parsed = printWebhookDataSchema.safeParse(raw);
  if (!parsed.success) throw new WebhookRejected('invalid_data', parsed.error.message);
  const data = parsed.data;
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${data.orderRef} FOR UPDATE`;
  const job = await tx.printJob.findUnique({
    where: { partnerRef: data.partnerRef },
    include: { order: true },
  });
  if (
    !job ||
    job.orderId !== data.orderRef ||
    job.order.number !== data.orderNumber ||
    job.attempt !== data.attempt
  )
    throw new WebhookRejected(
      'unknown_printjob',
      'Job does not match partner reference, order and attempt.',
    );
  if (data.status === job.status) return;
  // Replayed older stages never roll production backwards, even with a fresh eventId.
  if (RANK.includes(data.status) && RANK.indexOf(data.status) < RANK.indexOf(job.status)) return;
  if (!NEXT[job.status].includes(data.status))
    throw new WebhookRejected(
      'invalid_print_transition',
      `${job.status} cannot become ${data.status}.`,
    );
  await reportLate(tx, job, job.order.number, at);
  const updated = await tx.printJob.update({
    where: { id: job.id },
    data: { status: data.status },
  });
  await recordStatus(tx, updated, job.order.number, at);
  if (data.status === 'misprint')
    await recordEvent(tx, {
      type: 'printjob.misprint',
      entityType: 'printjob',
      entityId: job.id,
      payload: {
        orderNumber: job.order.number,
        partnerRef: data.partnerRef,
        attempt: data.attempt,
        skus: data.skus,
      },
      at,
    });
}
export function registerPrinthubHandlers(): void {
  registerWebhookHandler('printhub', 'printjob.status', (tx, e) =>
    handlePrintStatus(tx, e.data, new Date(e.occurredAt)),
  );
}
registerPrinthubHandlers();

/** One alert per overdue active job, including when multiple store processes tick. */
export async function markLatePrintJobs(db: PrismaClient, now: Date): Promise<string[]> {
  const jobs = await db.printJob.findMany({
    where: { status: { in: ACTIVE }, dueAt: { lt: now }, lateReportedAt: null },
    take: 200,
    orderBy: { dueAt: 'asc' },
  });
  const reported: string[] = [];
  for (const row of jobs) {
    const done = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${row.orderId} FOR UPDATE`;
      const job = await tx.printJob.findUniqueOrThrow({
        where: { id: row.id },
        include: { order: true },
      });
      return reportLate(tx, job, job.order.number, now);
    });
    if (done) reported.push(row.id);
  }
  return reported;
}
export async function listPrintJobs(db: PrismaClient, status?: PrintStatus) {
  const jobs = await db.printJob.findMany({
    where: status ? { status } : {},
    include: { order: { select: { number: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return jobs.map(({ order, ...job }) => ({ ...job, orderNumber: order.number }));
}
