import { describe, expect, it, vi } from 'vitest';
import { HELP, run, type CliDeps } from './cli';
import { COMMANDS } from './commands';
import { loadConfig, parseDotenv } from './env';
import { parseRupees } from './money';

const ENV = { SG_API_URL: 'http://store.test/api/v1', SG_API_KEY: 'sg_finance_abc' };

type Reply = () => Response;

function json(status: number, body: unknown): Reply {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

function deps(reply: Reply, extra: Partial<CliDeps> = {}) {
  const fetchMock = vi.fn(async () => reply());
  return {
    fetchMock,
    d: { fetch: fetchMock as unknown as typeof fetch, env: ENV, cwd: '/nowhere', ...extra },
  };
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  };
}

describe('sg help and usage', () => {
  it('prints help with no arguments or with help', async () => {
    const { d } = deps(json(200, {}));
    expect(await run([], d)).toEqual({ code: 0, out: HELP });
    expect(await run(['help'], d)).toEqual({ code: 0, out: HELP });
    expect(HELP).toContain('refunds');
  });

  it('shows a group, or one command with an example', async () => {
    const { d } = deps(json(200, {}));
    expect((await run(['help', 'refunds'], d)).out).toContain('sg refunds create <order>');
    const one = await run(['refunds', 'create', '--help'], d);
    expect(one.code).toBe(0);
    expect(one.out).toContain('sg refunds create ORD-1042 --amount 799 --reason misprint');
  });

  it('fails on unknown commands and options with exit code 2, without calling the API', async () => {
    const { d, fetchMock } = deps(json(200, {}));
    expect((await run(['nope'], d)).code).toBe(2);
    expect((await run(['orders', 'nope'], d)).code).toBe(2);
    const bad = await run(['orders', 'list', '--colour', 'red'], d);
    expect(bad.code).toBe(2);
    expect(bad.out).toContain('unknown option --colour');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has a unique, documented command for every entry', () => {
    const names = COMMANDS.map((c) => c.words.join(' '));
    expect(new Set(names).size).toBe(names.length);
    for (const c of COMMANDS) expect(c.example.startsWith(`sg ${c.words[0]}`)).toBe(true);
  });
});

describe('sg requests', () => {
  it('lists orders with a status filter and the bearer key', async () => {
    const { d, fetchMock } = deps(
      json(200, [{ number: 'ORD-1', status: 'paid', totalPaise: 129900 }]),
    );
    const result = await run(['orders', 'list', '--status', 'paid'], d);
    const call = lastCall(fetchMock);
    expect(call.url).toBe('http://store.test/api/v1/orders?status=paid');
    expect(call.init.method).toBe('GET');
    expect(call.headers.authorization).toBe('Bearer sg_finance_abc');
    expect(result).toEqual({ code: 0, out: 'ORD-1  status=paid  total=₹1,299' });
  });

  it('rejects an invalid status choice before calling the API', async () => {
    const { d, fetchMock } = deps(json(200, []));
    const result = await run(['orders', 'list', '--status', 'lost'], d);
    expect(result.code).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a refund in paise built from rupees', async () => {
    const { d, fetchMock } = deps(
      json(201, { id: 'rf_1', orderNumber: 'ORD-1042', amountPaise: 79900 }),
    );
    const result = await run(
      ['refunds', 'create', 'ORD-1042', '--amount', '799', '--reason', 'misprint'],
      d,
    );
    const call = lastCall(fetchMock);
    expect(call.url).toBe('http://store.test/api/v1/refunds');
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({ orderNumber: 'ORD-1042', amountPaise: 79900, reason: 'misprint' });
    expect(result.out).toBe('id: rf_1\norderNumber: ORD-1042\namount: ₹799');
  });

  it('passes the ticket number and handles --flag=value and decimals', async () => {
    const { d, fetchMock } = deps(json(201, {}));
    await run(
      ['refunds', 'request', 'ORD-1', '--amount=799.5', '--reason=size', '--ticket', 'TCK-7'],
      d,
    );
    expect(lastCall(fetchMock).body).toEqual({
      orderNumber: 'ORD-1',
      amountPaise: 79950,
      reason: 'size',
      ticketNumber: 'TCK-7',
    });
  });

  it('requires flags and positionals, and rejects bad amounts', async () => {
    const { d, fetchMock } = deps(json(201, {}));
    expect((await run(['refunds', 'create', 'ORD-1', '--reason', 'x'], d)).out).toContain(
      '--amount is required',
    );
    expect((await run(['refunds', 'create', '--amount', '5', '--reason', 'x'], d)).out).toContain(
      'missing <order>',
    );
    for (const amount of ['0', '-5', '12.345', 'abc', '1e3']) {
      const bad = await run(['refunds', 'create', 'ORD-1', '--amount', amount, '--reason', 'x'], d);
      expect(bad.code).toBe(2);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts path arguments in the URL, escaped', async () => {
    const { d, fetchMock } = deps(json(200, { number: 'ORD-1' }));
    await run(['orders', 'get', 'ORD-1/../x'], d);
    expect(lastCall(fetchMock).url).toBe('http://store.test/api/v1/orders/ORD-1%2F..%2Fx');
  });

  it('decides approvals with the right body', async () => {
    const { d, fetchMock } = deps(json(200, { id: 'APR-7', status: 'approved' }));
    await run(['approvals', 'approve', 'APR-7'], d);
    expect(lastCall(fetchMock).url).toBe('http://store.test/api/v1/approvals/APR-7/decision');
    expect(lastCall(fetchMock).body).toEqual({ decision: 'approve' });
    await run(['approvals', 'reject', 'APR-7', '--reason', 'too high'], d);
    expect(lastCall(fetchMock).body).toEqual({ decision: 'reject', reason: 'too high' });
    expect((await run(['approvals', 'reject', 'APR-7'], d)).out).toContain('--reason is required');
  });

  it('converts on/off for flags and budgets for campaigns', async () => {
    const { d, fetchMock } = deps(json(200, {}));
    await run(['flags', 'set', 'checkout', 'off'], d);
    expect(lastCall(fetchMock).init.method).toBe('PUT');
    expect(lastCall(fetchMock).body).toEqual({ enabled: false });
    expect((await run(['flags', 'set', 'checkout', 'maybe'], d)).code).toBe(2);

    await run(
      ['campaigns', 'create', '--name', 'Diwali', '--channel', 'instagram', '--budget', '5000'],
      d,
    );
    expect(lastCall(fetchMock).body).toEqual({
      name: 'Diwali',
      channel: 'instagram',
      budgetPaise: 500000,
    });
  });

  it('sends a bare close flag on ticket replies', async () => {
    const { d, fetchMock } = deps(json(200, {}));
    await run(['tickets', 'reply', 'TCK-7', '--message', 'Shipping today', '--close'], d);
    expect(lastCall(fetchMock).body).toEqual({ message: 'Shipping today', close: true });
  });
});

describe('sg responses', () => {
  it('prints the approval wait line on 202 and exits 0', async () => {
    const { d } = deps(json(202, { approvalId: 'APR-7', status: 'pending' }));
    const result = await run(
      ['refunds', 'create', 'ORD-1', '--amount', '1500', '--reason', 'x'],
      d,
    );
    expect(result).toEqual({ code: 0, out: 'Waiting for founder approval: APR-7' });
  });

  it('prints raw JSON with --json, including for 202', async () => {
    const { d } = deps(json(200, [{ number: 'ORD-1', totalPaise: 100 }]));
    const result = await run(['orders', 'list', '--json'], d);
    expect(JSON.parse(result.out)).toEqual([{ number: 'ORD-1', totalPaise: 100 }]);
    const pending = deps(json(202, { approvalId: 'APR-7', status: 'pending' }));
    const approval = await run(['shipments', 'reship', 'sh_1', '--json'], pending.d);
    expect(JSON.parse(approval.out)).toEqual({ approvalId: 'APR-7', status: 'pending' });
  });

  it('exits 1 with a short message on API errors', async () => {
    const forbidden = deps(json(403, { error: 'forbidden', details: { scope: 'refunds:write' } }));
    expect(await run(['refunds', 'list'], forbidden.d)).toEqual({
      code: 1,
      out: 'sg: 403 forbidden: scope refunds:write',
    });
    const conflict = deps(json(409, { error: 'already_exists' }));
    expect((await run(['print-jobs', 'create', 'ORD-1'], conflict.d)).out).toBe(
      'sg: 409 already_exists',
    );
    const html = deps(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect((await run(['health'], html.d)).code).toBe(1);
  });

  it('exits 1 when the store cannot be reached', async () => {
    const d: CliDeps = {
      fetch: (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as unknown as typeof fetch,
      env: ENV,
      cwd: '/nowhere',
    };
    const result = await run(['orders', 'list'], d);
    expect(result.code).toBe(1);
    expect(result.out).toContain('could not reach http://store.test/api/v1');
  });

  it('says so when a list is empty', async () => {
    const { d } = deps(json(200, []));
    expect((await run(['tickets', 'list'], d)).out).toBe('Nothing found.');
  });
});

describe('sg configuration', () => {
  it('reads SG_API_URL and SG_API_KEY from .env in the working folder', async () => {
    const { fetchMock } = deps(json(200, []));
    const result = await run(['orders', 'list'], {
      fetch: fetchMock as unknown as typeof fetch,
      env: {},
      cwd: '/work/finance',
      readFile: (path) => {
        expect(path).toBe('/work/finance/.env');
        return '# store\nSG_API_URL="http://localhost:3000/api/v1/"\nSG_API_KEY=sg_finance_xyz # key\n';
      },
    });
    expect(result.code).toBe(0);
    expect(lastCall(fetchMock).url).toBe('http://localhost:3000/api/v1/orders');
    expect(lastCall(fetchMock).headers.authorization).toBe('Bearer sg_finance_xyz');
  });

  it('prefers the process environment over .env, and accepts a bare store URL', () => {
    const config = loadConfig(
      { SG_API_KEY: 'sg_a_1', SG_STORE_URL: 'http://localhost:3000' },
      '/x',
      () => 'SG_API_KEY=sg_b_2\nSG_API_URL=http://other/api/v1',
    );
    expect(config).toEqual({ baseUrl: 'http://other/api/v1', apiKey: 'sg_a_1' });
    expect(
      loadConfig({ SG_API_KEY: 'k', SG_STORE_URL: 'http://localhost:3000' }, '/x', () => {
        throw new Error('no file');
      }),
    ).toEqual({ baseUrl: 'http://localhost:3000/api/v1', apiKey: 'k' });
  });

  it('fails clearly with exit code 2 when the URL or key is missing, without calling the API', async () => {
    const { fetchMock } = deps(json(200, []));
    const base = {
      fetch: fetchMock as unknown as typeof fetch,
      cwd: '/x',
      readFile: () => {
        throw new Error('none');
      },
    };
    const noKey = await run(['orders', 'list'], { ...base, env: { SG_API_URL: 'http://x' } });
    expect(noKey).toEqual({
      code: 2,
      out: 'sg: SG_API_KEY is not set. Put it in the .env of this folder.',
    });
    const noUrl = await run(['orders', 'list'], { ...base, env: { SG_API_KEY: 'k' } });
    expect(noUrl.out).toContain('SG_API_URL is not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses .env lines', () => {
    expect(parseDotenv("export A=1\nB='two words'\n\n#C=3\nD=4 # note\nbad line")).toEqual({
      A: '1',
      B: 'two words',
      D: '4',
    });
  });
});

describe('rupees', () => {
  it('converts typed rupees to integer paise', () => {
    expect(parseRupees('799')).toBe(79900);
    expect(parseRupees('799.5')).toBe(79950);
    expect(parseRupees('₹1,299.05')).toBe(129905);
    expect(parseRupees('0.10')).toBe(10);
    for (const bad of ['', '0', '0.00', '-1', '1.234', 'abc', '1e3', '12 34']) {
      expect(parseRupees(bad)).toBeNull();
    }
  });
});
