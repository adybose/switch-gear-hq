import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './db';
import { LedgerError, postLedgerTxn } from './ledger';

// Needs a migrated Postgres (DATABASE_URL). CI provides one; locally run
// `docker compose up -d db && npm run db:migrate` with DATABASE_URL in .env.
describe.skipIf(!process.env.DATABASE_URL)('ledger (database)', () => {
  let db: Db;
  const refId = `test-${randomUUID()}`;

  beforeAll(() => {
    db = createDb();
  });

  afterAll(async () => {
    // Deleting whole balanced txns keeps every txn balanced at commit.
    await db.ledgerEntry.deleteMany({ where: { refId } });
    await db.$disconnect();
  });

  it('writes a balanced txn', async () => {
    const { txnId, entries } = await postLedgerTxn(db, {
      refType: 'test',
      refId,
      lines: [
        { account: 'bank', debitPaise: 79900 },
        { account: 'sales', creditPaise: 79900 },
      ],
    });
    expect(entries).toHaveLength(2);
    const rows = await db.ledgerEntry.findMany({ where: { txnId } });
    expect(rows.reduce((sum, r) => sum + r.debitPaise - r.creditPaise, 0)).toBe(0);
  });

  it('service rejects an unbalanced txn and writes nothing', async () => {
    await expect(
      postLedgerTxn(db, {
        refType: 'test',
        refId,
        lines: [
          { account: 'bank', debitPaise: 1000 },
          { account: 'sales', creditPaise: 900 },
        ],
      }),
    ).rejects.toThrow(LedgerError);
    expect(await db.ledgerEntry.count({ where: { refId } })).toBe(2);
  });

  it('database rejects an unbalanced txn written around the service', async () => {
    const txnId = randomUUID();
    await expect(
      db.ledgerEntry.createMany({
        data: [
          { txnId, account: 'bank', debitPaise: 1000, refId },
          { txnId, account: 'sales', creditPaise: 900, refId },
        ],
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(await db.ledgerEntry.count({ where: { txnId } })).toBe(0);
  });

  it('database rejects a line with both sides set', async () => {
    const txnId = randomUUID();
    await expect(
      db.ledgerEntry.create({
        data: { txnId, account: 'bank', debitPaise: 100, creditPaise: 100, refId },
      }),
    ).rejects.toThrow();
  });
});
