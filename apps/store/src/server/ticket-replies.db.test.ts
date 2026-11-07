import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/v1/tickets/[number]/route';
import { POST } from '../app/api/v1/tickets/[number]/reply/route';
import { loadOrCreateKeys } from './api-keys';
import { createDb, type Db } from './db';
import * as events from './events';
import { resetDemo } from './seed/seed';
import { createTicket, replyToTicket } from './tickets';

// Real database/route tests catch missing scopes, lost concurrent replies and partial commits.
describe.skipIf(!process.env.DATABASE_URL)('ticket detail and replies (database)', () => {
  let db: Db;
  const now = new Date('2026-11-08T10:00:00.000Z');
  const options = {
    keysPath: join(mkdtempSync(join(tmpdir(), 'sg-ticket-replies-')), '.env.local.keys'),
    founderEmail: 'founder@example.com',
    founderPassword: 'test-only-founder-password',
  };
  const params = (number = 'TCK-1') => ({ params: Promise.resolve({ number }) });
  function request(department?: string, body?: unknown) {
    const keys = loadOrCreateKeys(options.keysPath).keys;
    return new Request('http://localhost/api/v1/tickets/TCK-1', {
      method: body === undefined ? 'GET' : 'POST',
      headers: department
        ? { authorization: `Bearer ${keys[department as keyof typeof keys]}` }
        : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  beforeAll(() => {
    db = createDb();
  });
  beforeEach(async () => {
    await resetDemo(db, options);
    await createTicket(
      db,
      { email: 'customer@example.com', orderNumber: undefined, type: 'other', message: 'Hello' },
      now,
    );
  });
  afterAll(async () => {
    await resetDemo(db, options);
    await db.$disconnect();
  });

  it('returns the public Ticket shape for support, hq and founder, without mutating it', async () => {
    for (const department of ['support', 'hq', 'founder']) {
      const response = await GET(request(department), params());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        number: 'TCK-1',
        orderNumber: null,
        type: 'other',
        status: 'open',
        messages: [{ from: 'customer', body: 'Hello', at: '2026-11-08T10:00:00.000Z' }],
      });
    }
    expect(await db.event.count()).toBe(1);
  });

  it('requires read scope for detail and reply write scope for posting, before ticket lookup', async () => {
    for (const department of ['finance', 'fulfilment', 'marketing', 'engineering']) {
      expect((await GET(request(department), params('TCK-missing'))).status).toBe(403);
    }
    for (const department of [
      'finance',
      'fulfilment',
      'marketing',
      'engineering',
      'hq',
      'founder',
    ]) {
      expect((await POST(request(department, { message: 'No' }), params())).status).toBe(403);
    }
    expect((await GET(request(), params())).status).toBe(401);
    expect((await POST(request(undefined, { message: 'No' }), params())).status).toBe(401);
    const invalid = new Request('http://localhost', {
      headers: { authorization: 'Bearer sg_support_invalid' },
    });
    expect((await GET(invalid, params())).status).toBe(401);
    expect((await POST(invalid, params())).status).toBe(401);
    expect(await db.emailOutbox.count()).toBe(0);
    expect(await db.event.count()).toBe(1);
  });

  it('returns 404 for a missing ticket and leaves no queued email or event', async () => {
    expect((await GET(request('support'), params('TCK-999'))).status).toBe(404);
    const response = await POST(request('support', { message: 'Hi' }), params('TCK-999'));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
    expect(await db.emailOutbox.count()).toBe(0);
    expect(await db.event.count()).toBe(1);
  });

  it('appends a support reply, defaults to waiting and queues email with a business timestamp', async () => {
    const reply = await replyToTicket(db, 'TCK-1', { message: 'Here to help', close: false }, now);
    expect(reply).toMatchObject({ number: 'TCK-1', status: 'waiting' });
    const response = await GET(request('support'), params());
    expect((await response.json()).messages).toEqual([
      { from: 'customer', body: 'Hello', at: '2026-11-08T10:00:00.000Z' },
      { from: 'support', body: 'Here to help', at: '2026-11-08T10:00:00.000Z' },
    ]);
    const mail = await db.emailOutbox.findFirstOrThrow();
    expect(mail).toMatchObject({
      to: 'customer@example.com',
      subject: 'Re: TCK-1',
      body: 'Here to help',
      createdAt: now,
    });
    const event = await db.event.findFirstOrThrow({ where: { type: 'ticket.replied' } });
    expect(event).toMatchObject({
      entityType: 'ticket',
      entityId: 'TCK-1',
      payload: { ticketNumber: 'TCK-1', status: 'waiting' },
      createdAt: now,
    });
    expect(JSON.stringify(event.payload)).not.toContain('customer@example.com');
    expect(JSON.stringify(event.payload)).not.toContain('Here to help');
  });

  it('accepts close=true and can reply again to a closed ticket', async () => {
    const response = await POST(request('support', { message: 'Resolved', close: true }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ number: 'TCK-1', status: 'closed' });
    const reopened = await POST(request('support', { message: 'Following up' }), params());
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({
      status: 'waiting',
      messages: expect.arrayContaining([
        { from: 'support', body: 'Following up', at: expect.any(String) },
      ]),
    });
    expect(await db.emailOutbox.count()).toBe(2);
    expect(await db.event.count({ where: { type: 'ticket.replied' } })).toBe(2);
  });

  it('rejects malformed, blank, overlong and incorrectly typed replies before writing', async () => {
    for (const body of [
      {},
      { message: '' },
      { message: '  ' },
      { message: 1 },
      { message: 'x'.repeat(2001) },
      { message: 'Hello', close: 'true' },
    ]) {
      expect((await POST(request('support', body), params())).status).toBe(422);
    }
    const malformed = request('support', {});
    const broken = new Request(malformed, { body: '{' });
    expect((await POST(broken, params())).status).toBe(422);
    expect(await db.emailOutbox.count()).toBe(0);
    expect(await db.event.count()).toBe(1);
    expect((await db.ticket.findUniqueOrThrow({ where: { number: 'TCK-1' } })).status).toBe('open');
  });

  it('preserves both concurrent replies with their email and event rows', async () => {
    await Promise.all([
      replyToTicket(db, 'TCK-1', { message: 'First', close: false }, now),
      replyToTicket(db, 'TCK-1', { message: 'Second', close: false }, now),
    ]);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { number: 'TCK-1' } });
    expect(ticket.messages).toEqual(
      expect.arrayContaining([
        { from: 'support', body: 'First', at: now.toISOString() },
        { from: 'support', body: 'Second', at: now.toISOString() },
      ]),
    );
    expect(ticket.messages).toHaveLength(3);
    expect(await db.emailOutbox.count()).toBe(2);
    expect(await db.event.count({ where: { type: 'ticket.replied' } })).toBe(2);
  });

  it('rolls back message, status and queued email when the event write fails', async () => {
    const spy = vi
      .spyOn(events, 'recordEvent')
      .mockRejectedValueOnce(new Error('outbox unavailable'));
    try {
      await expect(
        replyToTicket(db, 'TCK-1', { message: 'Fail', close: true }, now),
      ).rejects.toThrow('outbox unavailable');
    } finally {
      spy.mockRestore();
    }
    expect(await db.emailOutbox.count()).toBe(0);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { number: 'TCK-1' } });
    expect(ticket.status).toBe('open');
    expect(ticket.messages).toHaveLength(1);
    expect(await db.event.count()).toBe(1);
  });
});
