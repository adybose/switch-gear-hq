import { z } from 'zod';
import {
  SHIPMENT_COST,
  SHIPFAST_PICKUP,
  shipmentAcceptedSchema,
  shipmentCreateSchema,
  shipmentWebhookDataSchema,
  type ShipmentStatus,
} from '@switch-gear/shared/shipfast';
import { checkPincode } from '@switch-gear/shared/shipping';
import { SIGNATURE_HEADER, signWebhook, webhookSecret } from '@switch-gear/shared/webhooks';
import type { Prisma, PrismaClient, Shipment } from '../generated/prisma/client';
import { registerApprovalAction, requestApproval, type PendingApproval } from './approvals';
import { recordEvent } from './events';
import { loadLimits, reshipGate } from './gates';
import { registerWebhookHandler, WebhookRejected } from './webhooks';

export class ShipmentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface ShipmentOptions {
  simUrl?: string;
  fetch?: typeof globalThis.fetch;
}
const RESHIP_ACTION = 'shipment.reship';
const storedReshipSchema = z
  .object({
    shipmentId: z.string().min(1).max(100),
    orderRef: z.string().min(1).max(64),
    sequence: z.number().int().min(2),
  })
  .strict();

async function loadOrder(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  return tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { select: { qty: true } },
      printJobs: { orderBy: { attempt: 'desc' }, take: 1 },
      shipments: { orderBy: { sequence: 'desc' }, take: 1 },
    },
  });
}
type ShippingOrder = Awaited<ReturnType<typeof loadOrder>>;
function reshipSource(order: ShippingOrder, id: string): Shipment {
  const source = order.shipments[0];
  if (
    !source ||
    source.id !== id ||
    !['returned_to_origin', 'lost'].includes(source.status) ||
    !['returned', 'shipped'].includes(order.status)
  )
    throw new ShipmentError(
      'not_reshippable',
      409,
      'Only the latest returned or lost shipment can be replaced.',
    );
  return source;
}

/** Used only after readiness or an approval executor has authorized this booking. */
async function book(
  tx: Prisma.TransactionClient,
  order: ShippingOrder,
  options: ShipmentOptions,
  source?: Shipment,
  approvalId?: string,
): Promise<Shipment> {
  const area = checkPincode(order.shipPincode);
  if (!area.serviceable) throw new ShipmentError(area.reason, 422, area.message);
  const sequence = (source?.sequence ?? 0) + 1;
  const input = shipmentCreateSchema.parse({
    orderRef: order.id,
    orderNumber: order.number,
    sequence,
    ...(source ? { reshipOfAwb: source.awb } : {}),
    pickup: SHIPFAST_PICKUP,
    drop: {
      name: order.shipName,
      phone: order.shipPhone,
      address: order.shipAddress,
      city: order.shipCity,
      state: order.shipState,
      pincode: order.shipPincode,
    },
    weightGrams: order.items.reduce((n, item) => n + item.qty, 0) * 250,
  });
  const raw = JSON.stringify(input);
  let accepted;
  try {
    const res = await (options.fetch ?? globalThis.fetch)(
      new URL(
        '/shipfast/v1/shipments',
        options.simUrl ?? process.env.SIM_URL ?? 'http://localhost:4000',
      ),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signWebhook(webhookSecret('shipfast'), raw),
        },
        body: raw,
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!res.ok) throw new Error(`ShipFast answered ${res.status}`);
    accepted = shipmentAcceptedSchema.parse(await res.json());
    if (accepted.zone !== area.zone || accepted.costPaise !== SHIPMENT_COST[area.zone])
      throw new Error('ShipFast zone/cost mismatch');
  } catch (err) {
    throw new ShipmentError('shipfast_unavailable', 503, String(err));
  }
  const row = await tx.shipment.create({
    data: {
      orderId: order.id,
      awb: accepted.awb,
      status: 'pickup_scheduled',
      zone: accepted.zone,
      attempts: 0,
      sequence,
      reshipOfId: source?.id,
      approvalId,
      bookedAt: new Date(accepted.bookedAt),
      estimatedDeliveryAt: new Date(accepted.estimatedDeliveryAt),
      costPaise: accepted.costPaise,
    },
  });
  await tx.order.update({ where: { id: order.id }, data: { status: 'shipped' } });
  await recordStatus(tx, row, order.number, new Date(accepted.bookedAt));
  return row;
}

export async function createShipment(
  db: PrismaClient,
  number: string,
  options: ShipmentOptions = {},
): Promise<Shipment> {
  return db.$transaction(
    async (tx) => {
      const found = await tx.order.findUnique({ where: { number }, select: { id: true } });
      if (!found) throw new ShipmentError('not_found', 404, 'Order not found.');
      const order = await loadOrder(tx, found.id);
      if (
        order.status !== 'printing' ||
        order.shipments.length > 0 ||
        order.printJobs[0]?.status !== 'handed_over'
      )
        throw new ShipmentError(
          'order_not_shippable',
          409,
          'A PrintHub handover without an existing shipment is required.',
        );
      return book(tx, order, options);
    },
    { timeout: 15000, maxWait: 10000 },
  );
}

export async function reshipShipment(
  db: PrismaClient,
  id: string,
  options: ShipmentOptions = {},
): Promise<Shipment | PendingApproval> {
  return db.$transaction(
    async (tx) => {
      const found = await tx.shipment.findUnique({ where: { id }, select: { orderId: true } });
      if (!found) throw new ShipmentError('not_found', 404, 'Shipment not found.');
      const order = await loadOrder(tx, found.orderId);
      const source = reshipSource(order, id);
      const gate = reshipGate(await loadLimits(tx), { previousReships: source.sequence - 1 });
      if (gate.ok) return book(tx, order, options, source);
      const existing = await tx.approvalRequest.findFirst({
        where: {
          action: RESHIP_ACTION,
          status: 'pending',
          payload: { path: ['shipmentId'], equals: source.id },
        },
      });
      if (existing) return { approvalId: existing.number, status: 'pending' };
      return requestApproval(tx, {
        department: 'fulfilment',
        action: RESHIP_ACTION,
        payload: { shipmentId: source.id, orderRef: order.id, sequence: source.sequence + 1 },
        amountPaise: SHIPMENT_COST[source.zone],
        reason: gate.reason,
      });
    },
    { timeout: 15000, maxWait: 10000 },
  );
}

/** Registers the only route from a pending repeat reship to a courier booking. */
export function registerShipfastActions(options: ShipmentOptions = {}): void {
  registerApprovalAction(RESHIP_ACTION, async (tx, payload, approval) => {
    const parsed = approvalPayload(payload);
    const order = await loadOrder(tx, parsed.orderRef);
    const source = reshipSource(order, parsed.shipmentId);
    if (source.sequence + 1 !== parsed.sequence)
      throw new ShipmentError('stale_approval', 409, 'Reship history changed.');
    await book(tx, order, options, source, approval.id);
  });
}
function approvalPayload(payload: Prisma.JsonValue): {
  shipmentId: string;
  orderRef: string;
  sequence: number;
} {
  // Stored only by reshipShipment; still validate before executing a persisted action.
  const result = storedReshipSchema.safeParse(payload);
  if (!result.success) throw new ShipmentError('invalid_approval', 409, 'Invalid reship payload.');
  return result.data;
}

async function recordStatus(
  tx: Prisma.TransactionClient,
  row: Shipment,
  orderNumber: string,
  at: Date,
): Promise<void> {
  await recordEvent(tx, {
    type: 'shipment.status',
    entityType: 'shipment',
    entityId: row.id,
    payload: {
      orderNumber,
      awb: row.awb!,
      status: row.status,
      attempts: row.attempts,
      sequence: row.sequence,
      costPaise: row.costPaise,
    },
    at,
  });
}
function validNext(row: Shipment, status: ShipmentStatus, attempts: number): boolean {
  switch (row.status) {
    case 'pickup_scheduled':
      return status === 'picked_up' && attempts === 0;
    case 'picked_up':
      return status === 'in_transit' && attempts === 0;
    case 'in_transit':
      return (
        (status === 'out_for_delivery' && attempts === 1) || (status === 'lost' && attempts === 0)
      );
    case 'out_for_delivery':
      return ['delivered', 'delivery_failed'].includes(status) && attempts === row.attempts;
    case 'delivery_failed':
      return (
        (row.attempts < 3 && status === 'out_for_delivery' && attempts === row.attempts + 1) ||
        (row.attempts === 3 && status === 'returned_to_origin' && attempts === 3)
      );
    default:
      return false;
  }
}
export async function handleShipmentStatus(
  tx: Prisma.TransactionClient,
  raw: Record<string, unknown>,
  at: Date,
): Promise<void> {
  const parsed = shipmentWebhookDataSchema.safeParse(raw);
  if (!parsed.success) throw new WebhookRejected('invalid_data', parsed.error.message);
  const data = parsed.data;
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${data.orderRef} FOR UPDATE`;
  const row = await tx.shipment.findUnique({
    where: { awb: data.awb },
    include: { order: { include: { shipments: { orderBy: { sequence: 'desc' }, take: 1 } } } },
  });
  if (
    !row ||
    row.orderId !== data.orderRef ||
    row.order.number !== data.orderNumber ||
    row.sequence !== data.sequence
  )
    throw new WebhookRejected(
      'unknown_shipment',
      'Shipment does not match AWB, order and booking sequence.',
    );
  if (row.status === data.status && row.attempts === data.attempts) return;
  if (data.attempts < row.attempts) return;
  if (!validNext(row, data.status, data.attempts))
    throw new WebhookRejected(
      'invalid_shipment_transition',
      `${row.status} cannot become ${data.status} at attempt ${data.attempts}.`,
    );
  if (row.order.shipments[0]?.id !== row.id || row.order.status !== 'shipped')
    throw new WebhookRejected('inactive_shipment', 'Order no longer expects this shipment.');
  const expectedCost = SHIPMENT_COST[row.zone] * (data.status === 'returned_to_origin' ? 2 : 1);
  if (data.costPaise !== expectedCost)
    throw new WebhookRejected('cost_mismatch', 'Unexpected courier cost.');
  const updated = await tx.shipment.update({
    where: { id: row.id },
    data: {
      status: data.status,
      attempts: data.attempts,
      costPaise: expectedCost,
      ...(data.status === 'delivered' ? { deliveredAt: at } : {}),
    },
  });
  if (data.status === 'delivered' || data.status === 'returned_to_origin')
    await tx.order.update({
      where: { id: row.orderId },
      data: { status: data.status === 'delivered' ? 'delivered' : 'returned' },
    });
  await recordStatus(tx, updated, row.order.number, at);
  if (data.status === 'delivered')
    await recordEvent(tx, {
      type: 'shipment.delivered',
      entityType: 'shipment',
      entityId: row.id,
      payload: { orderNumber: row.order.number, awb: data.awb, deliveredAt: at.toISOString() },
      at,
    });
  if (data.status === 'delivery_failed' || data.status === 'lost')
    await recordEvent(tx, {
      type: 'shipment.failed',
      entityType: 'shipment',
      entityId: row.id,
      payload: {
        orderNumber: row.order.number,
        awb: data.awb,
        attempt: data.attempts,
        reason: data.reason ?? (data.status === 'lost' ? 'lost' : 'recipient_unavailable'),
      },
      at,
    });
  if (data.status === 'returned_to_origin')
    await recordEvent(tx, {
      type: 'shipment.rto',
      entityType: 'shipment',
      entityId: row.id,
      payload: {
        orderNumber: row.order.number,
        awb: data.awb,
        reason: data.reason ?? 'delivery_attempts_exhausted',
      },
      at,
    });
}
export function registerShipfastHandlers(): void {
  registerWebhookHandler('shipfast', 'shipment.status', (tx, e) =>
    handleShipmentStatus(tx, e.data, new Date(e.occurredAt)),
  );
}
registerShipfastHandlers();
registerShipfastActions();

export async function listShipments(db: PrismaClient, status?: ShipmentStatus) {
  const rows = await db.shipment.findMany({
    where: status ? { status } : {},
    include: { order: { select: { number: true } } },
    orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
    take: 200,
  });
  return rows.map(({ order, ...row }) => ({ ...row, orderNumber: order.number }));
}
