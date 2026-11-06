import { randomUUID } from 'node:crypto';
import type { LedgerAccount, LedgerEntry, Prisma, PrismaClient } from '../generated/prisma/client';

/** One line of a double-entry transaction: exactly one of debit or credit is positive. */
export interface LedgerLine {
  account: LedgerAccount;
  debitPaise?: number;
  creditPaise?: number;
}

export interface LedgerTxnInput {
  lines: LedgerLine[];
  refType?: string;
  refId?: string;
  memo?: string;
  at?: Date;
}

export class LedgerError extends Error {
  override name = 'LedgerError';
}

/**
 * Throws LedgerError unless the lines form a valid, balanced transaction:
 * at least two lines, integer non-negative paise, one side per line, debits = credits.
 */
export function assertBalanced(lines: LedgerLine[]): void {
  if (lines.length < 2) throw new LedgerError('a ledger txn needs at least two lines');

  let debits = 0;
  let credits = 0;
  lines.forEach((line, i) => {
    const debit = line.debitPaise ?? 0;
    const credit = line.creditPaise ?? 0;
    for (const amount of [debit, credit]) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new LedgerError(`line ${i}: amounts must be non-negative integer paise`);
      }
    }
    if ((debit === 0) === (credit === 0)) {
      throw new LedgerError(`line ${i}: exactly one of debitPaise or creditPaise must be > 0`);
    }
    debits += debit;
    credits += credit;
  });

  if (debits !== credits) {
    throw new LedgerError(
      `unbalanced ledger txn: debits ${debits} paise != credits ${credits} paise`,
    );
  }
}

type TxClient = Prisma.TransactionClient;

/**
 * Validates and writes one double-entry transaction. Pass a transaction client to
 * write it together with other changes (e.g. the outbox event); otherwise it runs in
 * its own transaction. The database also rejects an unbalanced txn at commit.
 */
export async function postLedgerTxn(
  db: PrismaClient | TxClient,
  input: LedgerTxnInput,
): Promise<{ txnId: string; entries: LedgerEntry[] }> {
  assertBalanced(input.lines);

  const txnId = randomUUID();
  const at = input.at ?? new Date();
  const write = async (tx: TxClient) => {
    const entries: LedgerEntry[] = [];
    for (const line of input.lines) {
      entries.push(
        await tx.ledgerEntry.create({
          data: {
            txnId,
            account: line.account,
            debitPaise: line.debitPaise ?? 0,
            creditPaise: line.creditPaise ?? 0,
            refType: input.refType,
            refId: input.refId,
            memo: input.memo,
            at,
          },
        }),
      );
    }
    return { txnId, entries };
  };

  return '$transaction' in db ? db.$transaction(write) : write(db);
}
