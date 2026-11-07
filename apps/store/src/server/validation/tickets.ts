import { z } from 'zod';

// Mirrors ticket and tracking endpoints in api/openapi.yaml.

export const ticketListQuery = z.object({
  status: z.enum(['open', 'waiting', 'closed']).optional(),
});

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
export type TicketListQuery = z.infer<typeof ticketListQuery>;

export const ticketReplyInput = z.object({
  message: z.string().trim().min(1).max(2000),
  close: z.boolean().default(false),
});

export type TicketReplyInput = z.infer<typeof ticketReplyInput>;
