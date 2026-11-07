import type { BusinessClock, StoreEvent } from '@switch-gear/shared';
import { describe, expect, it } from 'vitest';
import type { Decision } from './approvals';
import { Gatekeeper, resolveRooms } from './gatekeeper';
import { initialState, memoryState } from './state';
import type { ApprovalSummary, DecisionOutcome, StoreClient } from './store-client';
import type { AddressedMessage, SwitchHttp } from './switch-client';

const ROOMS = {
  hq: 'r-hq',
  approvals: 'r-approvals',
  engineering: 'r-engineering',
  fulfilment: 'r-fulfilment',
  finance: 'r-finance',
  marketing: 'r-marketing',
  support: 'r-support',
  events: 'r-events',
};
const FOUNDER = '@switch-slack-abc-founder:localhost';

function ev(seq: number, type: string, payload: Record<string, unknown>): StoreEvent {
  return {
    seq,
    type,
    entityType: 'x',
    entityId: 'x',
    payload,
    createdAt: '2026-11-07T06:00:00Z',
  } as StoreEvent;
}

const paid = (seq: number) =>
  ev(seq, 'order.paid', {
    orderNumber: `ORD-${1000 + seq}`,
    totalPaise: 79900,
    itemCount: 1,
    gstType: 'intra',
    paidAt: '',
  });

function setup(
  opts: {
    events?: StoreEvent[];
    failPostTo?: string;
    now?: Date;
    rooms?: Record<string, string>;
  } = {},
) {
  const posts: { room: string; text: string }[] = [];
  const decisions: Decision[] = [];
  let failPostTo = opts.failPostTo;
  const events = opts.events ?? [];
  let decideOutcome: DecisionOutcome = {
    ok: true,
    approval: { id: 'APR-7', department: 'finance', action: 'refund.create', status: 'approved' },
  };
  const approvals: Record<string, ApprovalSummary> = {
    'APR-7': { id: 'APR-7', department: 'finance', action: 'refund.create', status: 'approved' },
  };
  const store: StoreClient = {
    async events(after, limit = 100) {
      return events.filter((e) => e.seq > after).slice(0, limit);
    },
    async approval(id) {
      return approvals[id] ?? null;
    },
    async decide(decision) {
      decisions.push(decision);
      return decideOutcome;
    },
  };
  const switchHttp: SwitchHttp = {
    async listRooms() {
      return [];
    },
    async postMessage(room, text) {
      if (room === failPostTo) throw new Error('switch down');
      posts.push({ room, text });
    },
    async replyInRoom() {},
  };
  let now = opts.now ?? new Date('2026-11-07T06:00:00Z');
  const clock: BusinessClock = {
    read: async () => ({ now, speed: 1, source: 'sim' }),
    now: async () => now,
  };
  const state = memoryState(initialState());
  const gatekeeper = new Gatekeeper({
    store,
    switchHttp,
    clock,
    state,
    founderId: FOUNDER,
    founderName: 'founder',
    rooms: opts.rooms ?? ROOMS,
    log: () => {},
  });
  return {
    gatekeeper,
    posts,
    decisions,
    state,
    setNow: (d: Date) => (now = d),
    healSwitch: () => (failPostTo = undefined),
    setOutcome: (o: DecisionOutcome) => (decideOutcome = o),
  };
}

function message(over: Partial<AddressedMessage> = {}): AddressedMessage {
  return {
    roomId: 'r-approvals',
    sender: FOUNDER,
    senderName: 'founder',
    messageId: 'm1',
    threadId: null,
    body: '@gatekeeper approve APR-7',
    ...over,
  };
}

describe('resolveRooms', () => {
  it('matches plain, # and bridged names, and lets overrides win', () => {
    const rooms = resolveRooms(
      [
        { roomId: 'a', name: 'switch-gear-hq: events' },
        { roomId: 'b', name: '#approvals' },
        { roomId: 'c', name: 'finance' },
        { roomId: 'd', name: 'finance-archive' },
      ],
      { hq: 'z' },
    );
    expect(rooms).toEqual({ events: 'a', approvals: 'b', finance: 'c', hq: 'z' });
  });
});

describe('event delivery', () => {
  it('posts each event to #events, then the owning room with a mention, then rooms told', async () => {
    const t = setup({ events: [paid(1)] });
    expect(await t.gatekeeper.pollEvents()).toBe(1);
    expect(t.posts).toEqual([
      { room: 'r-events', text: '#1 `order.paid` · ORD-1001 · ₹799 · 1 item' },
      { room: 'r-fulfilment', text: '@fulfilment `order.paid` · ORD-1001 · ₹799 · 1 item' },
      { room: 'r-finance', text: '`order.paid` · ORD-1001 · ₹799 · 1 item' },
    ]);
    expect(t.state.get().eventsAfter).toBe(1);
  });

  it('posts order.placed and unknown types to #events only', async () => {
    const t = setup({
      events: [
        ev(1, 'order.placed', {
          orderNumber: 'ORD-1',
          totalPaise: 100,
          itemCount: 2,
          source: 'web',
        }),
        ev(2, 'something.new', {}),
      ],
    });
    await t.gatekeeper.pollEvents();
    expect(t.posts.map((p) => p.room)).toEqual(['r-events', 'r-events']);
    expect(t.state.get().eventsAfter).toBe(2);
  });

  it('keeps its cursor and resumes after a failed post, without skipping', async () => {
    const t = setup({ events: [paid(1), paid(2)], failPostTo: 'r-finance' });
    await expect(t.gatekeeper.pollEvents()).rejects.toThrow('switch down');
    expect(t.state.get().eventsAfter).toBe(0);
    t.healSwitch();
    expect(await t.gatekeeper.pollEvents()).toBe(2);
    expect(t.state.get().eventsAfter).toBe(2);
    // The next poll has nothing new.
    expect(await t.gatekeeper.pollEvents()).toBe(0);
  });

  it('pages through more than one batch', async () => {
    const t = setup({ events: Array.from({ length: 150 }, (_, i) => paid(i + 1)) });
    expect(await t.gatekeeper.pollEvents()).toBe(150);
    expect(t.state.get().eventsAfter).toBe(150);
  });

  it('asks the founder in #approvals and tells the requesting department', async () => {
    const t = setup({
      events: [
        ev(5, 'approval.requested', {
          approvalId: 'APR-7',
          department: 'finance',
          action: 'refund.create',
          amountPaise: 150000,
          reason: 'over ₹1,000',
        }),
      ],
    });
    await t.gatekeeper.pollEvents();
    const approvals = t.posts.find((p) => p.room === 'r-approvals')!;
    expect(approvals.text).toMatch(
      /^@founder `approval.requested` · APR-7 · finance · refund.create · ₹1,500/,
    );
    expect(approvals.text).toContain('`approve APR-7` or `reject APR-7 <reason>`');
    const finance = t.posts.find((p) => p.room === 'r-finance')!;
    expect(finance.text).not.toContain('@');
  });

  it('posts a decision in #approvals and mentions the requesting department in its room', async () => {
    const t = setup({
      events: [
        ev(6, 'approval.decided', {
          approvalId: 'APR-7',
          action: 'refund.create',
          decision: 'approved',
          decidedBy: 'founder',
          reason: null,
        }),
      ],
    });
    await t.gatekeeper.pollEvents();
    expect(t.posts.slice(1)).toEqual([
      {
        room: 'r-approvals',
        text: '`approval.decided` · APR-7 · refund.create · approved · by founder',
      },
      {
        room: 'r-finance',
        text: '@finance `approval.decided` · APR-7 · refund.create · approved · by founder',
      },
    ]);
  });

  it('skips a room it has not been added to, and still moves on', async () => {
    const rooms = Object.fromEntries(Object.entries(ROOMS).filter(([k]) => k !== 'marketing'));
    const t = setup({
      rooms,
      events: [
        ev(1, 'campaign.result', {
          campaignId: 'C1',
          name: 'Diwali',
          channel: 'google',
          spentPaise: 100,
          clicks: 1,
          orders: 0,
          revenuePaise: 0,
        }),
      ],
    });
    await t.gatekeeper.pollEvents();
    expect(t.posts.map((p) => p.room)).toEqual(['r-events', 'r-finance']);
    expect(t.state.get().eventsAfter).toBe(1);
  });
});

describe('founder decisions', () => {
  it('approves for the founder in #approvals and replies with the result', async () => {
    const t = setup();
    const replies: string[] = [];
    await t.gatekeeper.handleMessage(message(), async (text) => void replies.push(text));
    expect(t.decisions).toEqual([{ decision: 'approve', approvalId: 'APR-7' }]);
    expect(replies).toEqual(['APR-7 approved. The store ran `refund.create`.']);
  });

  it('passes a rejection reason through', async () => {
    const t = setup();
    await t.gatekeeper.handleMessage(
      message({ body: '@gatekeeper reject APR-7 not this time' }),
      async () => {},
    );
    expect(t.decisions).toEqual([
      { decision: 'reject', approvalId: 'APR-7', reason: 'not this time' },
    ]);
  });

  it('ignores everyone except the founder, and anything outside #approvals', async () => {
    const t = setup();
    const replies: string[] = [];
    const reply = async (text: string) => void replies.push(text);
    await t.gatekeeper.handleMessage(
      message({ sender: '@switch-agent-1234:localhost', senderName: 'finance' }),
      reply,
    );
    await t.gatekeeper.handleMessage(
      message({ sender: '@switch-slack-abc-someone:localhost', senderName: 'founder' }),
      reply,
    );
    await t.gatekeeper.handleMessage(message({ roomId: 'r-finance' }), reply);
    expect(t.decisions).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('explains a malformed decision without calling the store', async () => {
    const t = setup();
    const replies: string[] = [];
    await t.gatekeeper.handleMessage(
      message({ body: '@gatekeeper reject APR-7' }),
      async (text) => void replies.push(text),
    );
    await t.gatekeeper.handleMessage(
      message({ body: '@gatekeeper hello' }),
      async (text) => void replies.push(text),
    );
    expect(t.decisions).toEqual([]);
    expect(replies).toEqual([
      expect.stringContaining('needs a reason'),
      expect.stringContaining('only take decisions'),
    ]);
  });

  it('relays store refusals', async () => {
    const t = setup();
    const replies: string[] = [];
    const reply = async (text: string) => void replies.push(text);
    t.setOutcome({ ok: false, status: 409, code: 'already_decided' });
    await t.gatekeeper.handleMessage(message(), reply);
    t.setOutcome({ ok: false, status: 404, code: 'not_found' });
    await t.gatekeeper.handleMessage(message(), reply);
    t.setOutcome({ ok: false, status: 409, code: 'action_not_supported' });
    await t.gatekeeper.handleMessage(message(), reply);
    expect(replies).toEqual([
      'APR-7 was already decided; nothing changed.',
      "I can't find APR-7. Check the number.",
      expect.stringContaining('stays pending'),
    ]);
  });
});

describe('timers', () => {
  it('asks chief-of-staff for the daily report and nudges finance weekly, once each', async () => {
    const t = setup({ now: new Date('2026-11-08T10:00:00Z') }); // Sunday, IST
    await t.gatekeeper.tickTimers();
    expect(t.posts).toEqual([]);

    t.setNow(new Date('2026-11-08T19:00:00Z')); // Monday 00:30 IST
    await t.gatekeeper.tickTimers();
    await t.gatekeeper.tickTimers();
    expect(t.posts).toEqual([
      {
        room: 'r-hq',
        text: expect.stringMatching(
          /^@chief-of-staff `report.daily` · business day 2026-11-08 has ended/,
        ),
      },
      {
        room: 'r-finance',
        text: expect.stringMatching(/^@finance Weekly partner invoices · business week 2026-W45/),
      },
    ]);

    t.setNow(new Date('2026-11-09T19:00:00Z')); // Tuesday: a day, not a week
    await t.gatekeeper.tickTimers();
    expect(t.posts.slice(2).map((p) => p.room)).toEqual(['r-hq']);
  });
});
