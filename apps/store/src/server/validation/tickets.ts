import { z } from 'zod';

// Mirrors GET /orders/track and POST /tickets in api/openapi.yaml.

export const trackQuery = z.object({
  number: z.string().trim().min(1).max(40),
  email: z.email().max(200),
});

export const ticketInput = z.object({
  email: z.email().max(200),
  orderNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined)),
  type: z.enum(['wismo', 'exchange', 'return', 'complaint', 'other']),
  message: z.string().trim().min(1).max(2000),
});

export type TrackQuery = z.infer<typeof trackQuery>;
export type TicketInput = z.infer<typeof ticketInput>;
