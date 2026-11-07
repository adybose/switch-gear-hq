import { z } from 'zod';
import { PIN_PATTERN } from './shipping';

export const SHIPMENT_STATUSES = [
  'pickup_scheduled',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'returned_to_origin',
  'lost',
] as const;
export const shipmentStatusSchema = z.enum(SHIPMENT_STATUSES);
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;
export const SHIPMENT_COST = { same_city: 5000, same_zone: 6500, national: 8500 } as const;
export const shippingZoneSchema = z.enum(['same_city', 'same_zone', 'national']);
export const shipmentAddressSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(1).max(30),
  address: z.string().min(1).max(1000),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  pincode: z.string().regex(PIN_PATTERN),
});
export const SHIPFAST_PICKUP = {
  name: 'PrintHub Demo Warehouse',
  phone: '9876543210',
  address: '1 Demo Warehouse Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};
export const shipmentCreateSchema = z.object({
  orderRef: z.string().min(1).max(64),
  orderNumber: z.string().regex(/^ORD-\d{1,12}$/),
  sequence: z.number().int().min(1).max(1000),
  reshipOfAwb: z.string().min(1).max(100).optional(),
  pickup: shipmentAddressSchema,
  drop: shipmentAddressSchema,
  weightGrams: z.number().int().min(1).max(1_000_000),
});
export type ShipmentCreate = z.infer<typeof shipmentCreateSchema>;
export const shipmentAcceptedSchema = z.object({
  awb: z.string().min(1).max(100),
  status: z.literal('pickup_scheduled'),
  zone: shippingZoneSchema,
  attempts: z.literal(0),
  costPaise: z.number().int().positive(),
  bookedAt: z.iso.datetime({ offset: true }),
  estimatedDeliveryAt: z.iso.datetime({ offset: true }),
});
export type ShipmentAccepted = z.infer<typeof shipmentAcceptedSchema>;
export const shipmentWebhookDataSchema = z.object({
  awb: z.string().min(1).max(100),
  orderRef: z.string().min(1).max(64),
  orderNumber: z.string().regex(/^ORD-\d{1,12}$/),
  sequence: z.number().int().positive(),
  status: shipmentStatusSchema,
  attempts: z.number().int().min(0).max(3),
  costPaise: z.number().int().positive(),
  reason: z.string().min(1).max(500).optional(),
});
export type ShipmentWebhookData = z.infer<typeof shipmentWebhookDataSchema>;
