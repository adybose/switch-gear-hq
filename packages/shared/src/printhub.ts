import { z } from 'zod';

export const PRINT_SLA_MS = 2 * 86_400_000;
export const PRINT_STATUSES = [
  'received',
  'in_production',
  'quality_check',
  'packed',
  'handed_over',
  'artwork_rejected',
  'misprint',
  'blank_out_of_stock',
] as const;
export const printStatusSchema = z.enum(PRINT_STATUSES);
export type PrintStatus = z.infer<typeof printStatusSchema>;
export const PRINT_COST = { classic: 26000, oversized: 34000, premium: 42000 } as const;
export const printItemSchema = z.object({
  sku: z.string().min(1).max(100),
  fit: z.enum(['classic', 'oversized', 'premium']),
  colour: z.string().min(1).max(40),
  size: z.string().min(1).max(10),
  qty: z.number().int().min(1).max(100),
  artworkUrl: z.string().min(1).max(2000),
});
export const printCreateSchema = z.object({
  orderRef: z.string().min(1).max(64),
  orderNumber: z.string().regex(/^ORD-\d{1,12}$/),
  attempt: z.number().int().min(1).max(100),
  reprintOf: z.string().min(1).max(100).optional(),
  items: z.array(printItemSchema).min(1).max(100),
  shipTo: z.object({
    name: z.string().min(1).max(100),
    phone: z.string().min(1).max(30),
    address: z.string().min(1).max(1000),
    city: z.string().min(1).max(100),
    state: z.string().min(1).max(100),
    pincode: z.string().regex(/^\d{6}$/),
  }),
});
export type PrintCreate = z.infer<typeof printCreateSchema>;
export const printAcceptedSchema = z.object({
  partnerRef: z.string().min(1).max(100),
  status: z.literal('received'),
  costPaise: z.number().int().nonnegative(),
  acceptedAt: z.iso.datetime({ offset: true }),
});
export type PrintAccepted = z.infer<typeof printAcceptedSchema>;
export const printWebhookDataSchema = z.object({
  partnerRef: z.string().min(1).max(100),
  orderRef: z.string().min(1).max(64),
  orderNumber: z.string().regex(/^ORD-\d{1,12}$/),
  attempt: z.number().int().positive(),
  status: printStatusSchema,
  skus: z.array(z.string().min(1).max(100)).max(100),
});
export type PrintWebhookData = z.infer<typeof printWebhookDataSchema>;
