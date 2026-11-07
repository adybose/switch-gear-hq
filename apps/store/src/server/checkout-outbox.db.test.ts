import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { placeOrder } from './checkout';
import { createDb, type Db } from './db';
import { resetDemo } from './seed/seed';
import { checkoutInput } from './validation/checkout';

// If writing the event fails, the state change must not happen either.
vi.mock('./events', () => ({
  recordEvent: vi.fn(async () => {
    throw new Error('outbox unavailable');
  }),
}));

describe.skipIf(!process.env.DATABASE_URL)('order and event commit together (database)', () => {
  let db: Db;
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-outbox-tx-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };

  beforeAll(async () => {
    db = createDb();
    await resetDemo(db, options);
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('rolls back the order, items and customer when the event write fails', async () => {
    const input = checkoutInput.parse({
      items: [{ sku: 'SG-SILKBOARD-CLS-BLK-M', qty: 1 }],
      customer: {
        name: 'Rollback Test',
        email: 'rollback@example.com',
        phone: '9876543210',
        address: '1 Test Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
    });
    await expect(placeOrder(db, input, new Date())).rejects.toThrow('outbox unavailable');
    expect(await db.order.count()).toBe(0);
    expect(await db.orderItem.count()).toBe(0);
    expect(await db.customer.count()).toBe(0);
  });
});
