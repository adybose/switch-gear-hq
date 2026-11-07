import { describe, expect, it } from 'vitest';
import { ticketInput, trackQuery } from './tickets';

describe('track and ticket validation', () => {
  it('requires a valid email and an order number to track', () => {
    expect(trackQuery.safeParse({ number: 'ORD-1001', email: 'a@example.com' }).success).toBe(true);
    expect(trackQuery.safeParse({ number: 'ORD-1001', email: 'nope' }).success).toBe(false);
    expect(trackQuery.safeParse({ number: ' ', email: 'a@example.com' }).success).toBe(false);
  });

  it('accepts a ticket without an order and treats a blank order number as none', () => {
    const base = { email: 'a@example.com', type: 'other', message: 'Hello' };
    expect(ticketInput.parse(base).orderNumber).toBeUndefined();
    expect(ticketInput.parse({ ...base, orderNumber: '  ' }).orderNumber).toBeUndefined();
  });

  it('rejects unknown types, empty messages and messages over 2000 characters', () => {
    const base = { email: 'a@example.com', type: 'return', message: 'x' };
    expect(ticketInput.safeParse({ ...base, type: 'refund' }).success).toBe(false);
    expect(ticketInput.safeParse({ ...base, message: '   ' }).success).toBe(false);
    expect(ticketInput.safeParse({ ...base, message: 'x'.repeat(2001) }).success).toBe(false);
    expect(ticketInput.safeParse({ ...base, message: 'x'.repeat(2000) }).success).toBe(true);
  });
});
