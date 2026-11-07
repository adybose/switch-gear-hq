import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGatekeeperConfig } from './config';
import { fileState } from './state';
import { createStoreClient } from './store-client';

function fakeStore(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof globalThis.fetch;
  return {
    calls,
    client: createStoreClient({ baseUrl: 'http://store/api/v1', founderKey: 'fk', fetch }),
  };
}

describe('store client', () => {
  it('reads events after the cursor with the founder key', async () => {
    const { calls, client } = fakeStore(() =>
      Response.json([
        {
          seq: 4,
          type: 'order.paid',
          entityType: 'order',
          entityId: 'ORD-1',
          payload: {},
          createdAt: '',
        },
        null,
      ]),
    );
    expect(await client.events(3)).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://store/api/v1/events?after=3&limit=100');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer fk');
  });

  it('throws when the feed fails, so the cursor does not move', async () => {
    const { client } = fakeStore(() => Response.json({ error: 'forbidden' }, { status: 403 }));
    await expect(client.events(0)).rejects.toThrow('403');
  });

  it('sends decisions and reads the store error code', async () => {
    const { calls, client } = fakeStore((url) =>
      url.includes('APR-1')
        ? Response.json({
            id: 'APR-1',
            department: 'finance',
            action: 'refund.create',
            status: 'approved',
          })
        : Response.json(
            { error: 'already_decided', details: { id: 'APR-2 is approved' } },
            { status: 409 },
          ),
    );
    expect(await client.decide({ decision: 'approve', approvalId: 'APR-1' })).toEqual({
      ok: true,
      approval: { id: 'APR-1', department: 'finance', action: 'refund.create', status: 'approved' },
    });
    expect(await client.decide({ decision: 'reject', approvalId: 'APR-2', reason: 'no' })).toEqual({
      ok: false,
      status: 409,
      code: 'already_decided',
    });
    expect(calls[0]!.url).toBe('http://store/api/v1/approvals/APR-1/decision');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ decision: 'approve' });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ decision: 'reject', reason: 'no' });
  });
});

describe('state file', () => {
  it('keeps the cursor and the connection id across restarts', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gk-')), 'nested', 'state.json');
    const first = fileState(path);
    const connectionId = first.get().switch.connectionId;
    first.update((s) => {
      s.eventsAfter = 42;
      s.switch.cursor = 7;
    });
    const second = fileState(path);
    expect(second.get().eventsAfter).toBe(42);
    expect(second.get().switch).toMatchObject({ connectionId, cursor: 7 });
    expect(JSON.parse(readFileSync(path, 'utf8')).eventsAfter).toBe(42);
  });
});

describe('config', () => {
  it('runs health-only until every Switch setting is present', () => {
    const off = loadGatekeeperConfig({ SWITCH_URL: 'https://s' });
    expect(off.switch).toBeNull();
    expect(off.switchMissing).toEqual([
      'SWITCH_AGENT_ID',
      'SWITCH_AGENT_TOKEN',
      'SWITCH_FOUNDER_ID',
    ]);
    const on = loadGatekeeperConfig({
      STORE_URL: 'http://store:3000/',
      SWITCH_URL: 'https://s',
      SWITCH_AGENT_ID: 'a',
      SWITCH_AGENT_TOKEN: 't',
      SWITCH_FOUNDER_ID: '@f:x',
      SWITCH_ROOM_EVENTS: 'r-ev',
    });
    expect(on.storeApiUrl).toBe('http://store:3000/api/v1');
    expect(on.switch?.roomOverrides).toEqual({ events: 'r-ev' });
  });
});
