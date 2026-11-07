import { createHmac, timingSafeEqual } from 'node:crypto';

// Links to an order's confirmation page carry an HMAC of the order number, so knowing
// (or guessing) an order number is not enough to see someone else's order.

const TEST_SECRET = 'test-only-order-link-secret';

function secret(): string {
  return process.env.ORDER_LINK_SECRET || TEST_SECRET;
}

export function orderToken(orderNumber: string): string {
  return createHmac('sha256', secret()).update(`order:${orderNumber}`).digest('base64url');
}

export function verifyOrderToken(orderNumber: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(orderToken(orderNumber));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Path of the confirmation page, e.g. `/orders/ORD-1001?t=...`. */
export function orderPath(orderNumber: string): string {
  return `/orders/${encodeURIComponent(orderNumber)}?t=${orderToken(orderNumber)}`;
}
