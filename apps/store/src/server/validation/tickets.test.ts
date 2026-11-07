import { describe, expect, it } from 'vitest';
import { ticketInput, ticketListQuery, ticketReplyInput, trackQuery } from './tickets';

describe('track and ticket validation', () => {
  it('defaults replies to leaving the ticket waiting and validates the message and close flag', () => {
    expect(ticketReplyInput.parse({ message: ' Help ' })).toEqual({
      message: 'Help',
      close: false,
    });
    expect(ticketReplyInput.parse({ message: 'x'.repeat(2000), close: true }).close).toBe(true);
    for (const input of [
      {},
      { message: '' },
      { message: ' ' },
      { message: 1 },
      { message: 'x'.repeat(2001) },
      { message: 'Hi', close: 'true' },
    ]) {
      expect(ticketReplyInput.safeParse(input).success).toBe(false);
    }
  });
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

  it('lists all tickets by default and accepts only the three ticket statuses', () => {
    expect(ticketListQuery.parse({})).toEqual({});
    for (const status of ['open', 'waiting', 'closed']) {
      expect(ticketListQuery.parse({ status })).toEqual({ status });
    }
    for (const status of ['', 'paid', 'OPEN']) {
      expect(ticketListQuery.safeParse({ status }).success).toBe(false);
    }
  });
});
