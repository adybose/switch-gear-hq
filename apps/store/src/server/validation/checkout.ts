import { z } from 'zod';

// Mirrors POST /checkout and POST /checkout/quote in api/openapi.yaml.

const item = z.object({
  sku: z.string().trim().min(1).max(64),
  qty: z.number().int().min(1).max(10),
});

const items = z.array(item).min(1).max(20);

export const customerInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 -]{10,15}$/, 'Enter a 10-digit phone number'),
  address: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a 6-digit PIN code'),
});

const discountCode = z.string().trim().min(1).max(40).optional();

export const checkoutInput = z.object({
  items,
  customer: customerInput,
  discountCode,
  source: z.enum(['web', 'generator']).default('web'),
});

export const quoteInput = z.object({
  items,
  discountCode,
  state: z.string().trim().min(1).max(100).optional(),
  pincode: z.string().trim().optional(),
});

export type CheckoutInput = z.infer<typeof checkoutInput>;
export type QuoteInput = z.infer<typeof quoteInput>;

/** `{ field.path: message }` for a 422 `details` object. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '(body)';
    details[path] ??= issue.message;
  }
  return details;
}
