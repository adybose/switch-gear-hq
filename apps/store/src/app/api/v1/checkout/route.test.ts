import { describe, expect, it } from 'vitest';
import { orderPath, orderToken, verifyOrderToken } from '../../../../server/order-link';
import { POST } from './route';

// Requests that fail validation never reach the database.
const post = (body: string) =>
  POST(new Request('http://localhost/api/v1/checkout', { method: 'POST', body }));

describe('POST /api/v1/checkout validation', () => {
  it('rejects a body that is not JSON', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'invalid_json' });
  });

  it('reports each invalid field', async () => {
    const res = await post(
      JSON.stringify({
        items: [{ sku: 'SG-X', qty: 11 }],
        customer: {
          name: 'A',
          email: 'not-an-email',
          phone: '12',
          address: 'x',
          city: 'y',
          state: 'Goa',
          pincode: '012345',
        },
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; details: Record<string, string> };
    expect(body.error).toBe('validation_failed');
    expect(Object.keys(body.details).sort()).toEqual([
      'customer.email',
      'customer.phone',
      'customer.pincode',
      'items.0.qty',
    ]);
  });

  it('requires at least one item', async () => {
    const res = await post(JSON.stringify({ items: [], customer: {} }));
    expect(res.status).toBe(422);
  });
});

describe('order links', () => {
  it('verifies only the token for that order', () => {
    const token = orderToken('ORD-1001');
    expect(verifyOrderToken('ORD-1001', token)).toBe(true);
    expect(verifyOrderToken('ORD-1002', token)).toBe(false);
    expect(verifyOrderToken('ORD-1001', null)).toBe(false);
    expect(verifyOrderToken('ORD-1001', 'short')).toBe(false);
    expect(orderPath('ORD-1001')).toBe(`/orders/ORD-1001?t=${token}`);
  });
});
