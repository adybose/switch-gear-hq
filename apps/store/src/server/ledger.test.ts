import { describe, expect, it } from 'vitest';
import { assertBalanced, LedgerError } from './ledger';

describe('assertBalanced', () => {
  it('accepts a balanced txn', () => {
    expect(() =>
      assertBalanced([
        { account: 'gateway_receivable', debitPaise: 59900 },
        { account: 'sales', creditPaise: 57048 },
        { account: 'gst_output_payable', creditPaise: 2852 },
      ]),
    ).not.toThrow();
  });

  it('rejects an unbalanced txn', () => {
    expect(() =>
      assertBalanced([
        { account: 'bank', debitPaise: 1000 },
        { account: 'sales', creditPaise: 999 },
      ]),
    ).toThrow(/unbalanced/);
  });

  it('rejects fewer than two lines', () => {
    expect(() => assertBalanced([{ account: 'bank', debitPaise: 1 }])).toThrow(LedgerError);
  });

  it('rejects a line with both sides or neither side', () => {
    expect(() =>
      assertBalanced([
        { account: 'bank', debitPaise: 100, creditPaise: 100 },
        { account: 'sales' },
      ]),
    ).toThrow(/exactly one/);
  });

  it('rejects negative or fractional paise', () => {
    expect(() =>
      assertBalanced([
        { account: 'bank', debitPaise: -100 },
        { account: 'sales', creditPaise: -100 },
      ]),
    ).toThrow(/integer paise/);
    expect(() =>
      assertBalanced([
        { account: 'bank', debitPaise: 10.5 },
        { account: 'sales', creditPaise: 10.5 },
      ]),
    ).toThrow(/integer paise/);
  });
});
