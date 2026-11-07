import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '../app/api/v1/events/route';
import { parseKeysFile } from './api-keys';
import { createDb, type Db } from './db';
import { listEvents, recordEvent } from './events';
import { resetDemo } from './seed/seed';

// Needs a migrated Postgres (DATABASE_URL). Resets the database to the demo seed state.
describe.skipIf(!process.env.DATABASE_URL)('event outbox and events API (database)', () => {
  let db: Db;
  let keys: ReturnType<typeof parseKeysFile>;
  const keysPath = join(mkdtempSync(join(tmpdir(), 'sg-outbox-')), '.env.local.keys');
  const options = {
    keysPath,
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };

  const placed = (n: number) => ({
    type: 'order.placed' as const,
    entityType: 'order',
    entityId: `ORD-${n}`,
    payload: { orderNumber: `ORD-${n}`, totalPaise: 59900, itemCount: 1, source: 'web' as const },
  });

  const get = (query: string, key: string | null | undefined = keys.founder) =>
    GET(
      new Request(`http://localhost/api/v1/events${query}`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
      }),
    );

  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    keys = parseKeysFile(readFileSync(keysPath, 'utf8'));
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('lists events after a seq, oldest first, in pages', async () => {
    for (let n = 1; n <= 5; n++) await db.$transaction((tx) => recordEvent(tx, placed(n)));

    const page1 = await listEvents(db, 0, 2);
    expect(page1.map((e) => e.entityId)).toEqual(['ORD-1', 'ORD-2']);
    const page2 = await listEvents(db, page1.at(-1)!.seq, 2);
    expect(page2.map((e) => e.entityId)).toEqual(['ORD-3', 'ORD-4']);
    const page3 = await listEvents(db, page2.at(-1)!.seq, 2);
    expect(page3.map((e) => e.entityId)).toEqual(['ORD-5']);
    expect(await listEvents(db, page3.at(-1)!.seq, 2)).toEqual([]);

    expect(page1[0]).toMatchObject({
      seq: expect.any(Number),
      type: 'order.placed',
      entityType: 'order',
      payload: { orderNumber: 'ORD-1', totalPaise: 59900 },
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
    });
  });

  it('serves GET /events with a valid key, with paging and limits', async () => {
    for (let n = 1; n <= 3; n++) await db.$transaction((tx) => recordEvent(tx, placed(n)));

    const res = await get('?after=0&limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seq: number; entityId: string }[];
    expect(body.map((e) => e.entityId)).toEqual(['ORD-1', 'ORD-2']);

    const next = (await (await get(`?after=${body[1]!.seq}`)).json()) as { entityId: string }[];
    expect(next.map((e) => e.entityId)).toEqual(['ORD-3']);

    expect((await get('?limit=501')).status).toBe(422);
    expect((await get('?after=-1')).status).toBe(422);
  });

  it('bounds the cursor to the seq column range', async () => {
    const top = await get('?after=2147483647');
    expect(top.status).toBe(200);
    expect(await top.json()).toEqual([]);
    for (const after of ['2147483648', String(Number.MAX_SAFE_INTEGER), '1e400', '1.5', 'abc']) {
      const res = await get(`?after=${after}`);
      expect(res.status, after).toBe(422);
      expect(await res.json()).toMatchObject({
        error: 'validation_failed',
        details: { after: expect.any(String) },
      });
    }
  });

  it('refuses missing, unknown and revoked keys', async () => {
    expect((await get('', null)).status).toBe(401);
    expect((await get('', 'sg_founder_notarealkey')).status).toBe(401);
    await db.apiKey.updateMany({
      where: { department: 'founder' },
      data: { revokedAt: new Date() },
    });
    expect((await get('')).status).toBe(401);
    expect((await get('', keys.hq)).status).toBe(200);
    for (const d of ['fulfilment', 'finance', 'marketing', 'support', 'engineering'] as const) {
      const res = await get('', keys[d]);
      expect(res.status, d).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'forbidden' });
    }
  });

  it('commits events in seq order, so a reader never skips a late commit', async () => {
    // Transaction A writes an event and stays open; B tries to write meanwhile.
    let releaseA: () => void = () => {};
    const aMayCommit = new Promise<void>((resolve) => (releaseA = resolve));
    let aWrote: () => void = () => {};
    const aHasWritten = new Promise<void>((resolve) => (aWrote = resolve));

    const a = db.$transaction(
      async (tx) => {
        await recordEvent(tx, placed(1));
        aWrote();
        await aMayCommit;
      },
      { timeout: 10_000 },
    );
    await aHasWritten;

    let bDone = false;
    const b = db
      .$transaction((tx) => recordEvent(tx, placed(2)), { timeout: 10_000 })
      .then(() => (bDone = true));

    // B is blocked behind A's lock: nothing is visible and B hasn't finished.
    await new Promise((r) => setTimeout(r, 300));
    expect(bDone).toBe(false);
    expect(await listEvents(db, 0)).toEqual([]);

    releaseA();
    await Promise.all([a, b]);
    const events = await listEvents(db, 0);
    expect(events.map((e) => e.entityId)).toEqual(['ORD-1', 'ORD-2']);
    expect(events[0]!.seq).toBeLessThan(events[1]!.seq);
  });
});
