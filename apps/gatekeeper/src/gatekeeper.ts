// Gatekeeper: plain code, no AI (decision 2026-11-06). It moves store events into Switch rooms,
// carries the founder's approval decisions to the store, and runs two business-clock timers.

import { isEventType, type BusinessClock, type StoreEvent } from '@switch-gear/shared';
import { CHANNELS, ROUTES, departmentRoute, type Channel, type Mention } from '../routes';
import { parseDecision } from './approvals';
import { describeEvent, eventsRoomLine } from './format';
import type { StateStore } from './state';
import type { DecisionOutcome, StoreClient } from './store-client';
import type { AddressedMessage, SwitchHttp, SwitchRoom } from './switch-client';
import { checkTimers } from './timers';

export interface GatekeeperOptions {
  store: StoreClient;
  switchHttp: SwitchHttp;
  clock: BusinessClock;
  state: StateStore;
  /** The founder's Switch participant id (`@switch-…:server`); only it may decide. */
  founderId: string;
  /** The founder's Switch name, used to mention them. Empty: no mention. */
  founderName: string;
  rooms: Partial<Record<Channel, string>>;
  /** Looks the rooms up again; used when a post names a room Gatekeeper can't find yet. */
  refreshRooms?: () => Promise<Partial<Record<Channel, string>>>;
  log?: (line: string) => void;
}

/** A post to a room Gatekeeper is not in (yet). The delivery waits and is retried. */
export class MissingRoomError extends Error {
  constructor(readonly channel: Channel) {
    super(
      `no room for #${channel}: add Gatekeeper to it (or set SWITCH_ROOM_${channel.toUpperCase()})`,
    );
  }
}

interface PlannedPost {
  /** Unique within one event; saved once posted, so a retry skips it. */
  key: string;
  channel: Channel;
  text: string;
}

export function mentionText(mention: Mention | null, founderName: string): string {
  if (mention === null) return '';
  if (mention === 'founder') return founderName ? `@${founderName} ` : '';
  return `@${mention} `;
}

/**
 * Finds each channel's room among the rooms the agent belongs to. A room matches by its name
 * (`events`, `#events`), or by the suffix bridged rooms get (`switch-gear-hq: events`).
 * Explicit ids (SWITCH_ROOM_<CHANNEL>) win.
 */
export function resolveRooms(
  rooms: SwitchRoom[],
  overrides: Partial<Record<Channel, string>> = {},
): Partial<Record<Channel, string>> {
  const out: Partial<Record<Channel, string>> = {};
  for (const channel of CHANNELS) {
    if (overrides[channel]) {
      out[channel] = overrides[channel];
      continue;
    }
    const match = rooms.find((r) => {
      const name = r.name.trim().toLowerCase();
      return name === channel || name === `#${channel}` || name.endsWith(`: ${channel}`);
    });
    if (match) out[channel] = match.roomId;
  }
  return out;
}

export class Gatekeeper {
  private readonly log: (line: string) => void;
  private rooms: Partial<Record<Channel, string>>;
  /** Replies already worked out per founder message, so a retry never decides twice. */
  private readonly settled = new Map<string, string>();

  constructor(private readonly options: GatekeeperOptions) {
    this.log = options.log ?? ((line) => console.log(line));
    this.rooms = { ...options.rooms };
  }

  /**
   * Posts every new store event, in order. The cursor moves only once every post for an event
   * has gone out; a failure (Switch down, a room Gatekeeper isn't in) stops here and the next
   * poll retries the same event, skipping the posts already made.
   */
  async pollEvents(): Promise<number> {
    const { store, state } = this.options;
    let posted = 0;
    for (;;) {
      const events = await store.events(state.get().eventsAfter, 100);
      if (events.length === 0) return posted;
      for (const event of events) {
        await this.withRoomRetry(() => this.deliver(event));
        state.update((s) => {
          s.eventsAfter = event.seq;
          s.delivering = null;
        });
        posted += 1;
      }
      if (events.length < 100) return posted;
    }
  }

  /** #events first, then the owning room with a mention, then rooms told for context. */
  async deliver(event: StoreEvent): Promise<void> {
    const { state } = this.options;
    const plan = await this.plan(event);
    const progress = state.get().delivering;
    const done = new Set(progress?.seq === event.seq ? progress.done : []);
    for (const post of plan) {
      if (done.has(post.key)) continue;
      await this.post(post.channel, post.text);
      done.add(post.key);
      state.update((s) => {
        s.delivering = { seq: event.seq, done: [...done] };
      });
    }
  }

  private async plan(event: StoreEvent): Promise<PlannedPost[]> {
    const posts: PlannedPost[] = [
      { key: 'events', channel: 'events', text: eventsRoomLine(event) },
    ];
    if (!isEventType(event.type)) return posts;
    const route = ROUTES[event.type];
    if (!route) return posts;
    const line = describeEvent(event);
    const { founderName } = this.options;

    if (event.type === 'approval.decided') {
      posts.push({ key: 'record', channel: 'approvals', text: line });
      const approval = await this.options.store.approval(event.payload.approvalId);
      if (approval?.department) {
        const dept = departmentRoute(approval.department);
        if (dept.room !== 'approvals') {
          const text = `${mentionText(dept.mention, founderName)}${line}`;
          posts.push({ key: 'department', channel: dept.room, text });
        }
      }
      return posts;
    }

    const text =
      event.type === 'approval.requested'
        ? `${mentionText(route.mention, founderName)}${line}\nReply \`approve ${event.payload.approvalId}\` or \`reject ${event.payload.approvalId} <reason>\`, addressed to me.`
        : `${mentionText(route.mention, founderName)}${line}`;
    posts.push({ key: 'owner', channel: route.room, text });
    for (const room of route.also) posts.push({ key: `also:${room}`, channel: room, text: line });
    if (event.type === 'approval.requested') {
      const dept = departmentRoute(event.payload.department);
      if (dept.room !== route.room) {
        const fyi = `${line} · waiting for the founder`;
        posts.push({ key: 'department', channel: dept.room, text: fyi });
      }
    }
    return posts;
  }

  /** On a missing room, look the rooms up once more (it may have just been added) and retry. */
  private async withRoomRetry<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (!(err instanceof MissingRoomError) || !this.options.refreshRooms) throw err;
      this.rooms = { ...(await this.options.refreshRooms()) };
      return work();
    }
  }

  /** An addressed message. Only the founder, only in #approvals, only decisions. */
  async handleMessage(
    message: AddressedMessage,
    reply: (text: string) => Promise<void>,
  ): Promise<void> {
    const { founderId } = this.options;
    if (message.roomId !== this.rooms.approvals) {
      this.log(`ignored message outside #approvals from ${message.senderName}`);
      return;
    }
    if (!founderId || message.sender !== founderId) {
      this.log(`ignored message from ${message.senderName} (${message.sender}): not the founder`);
      return;
    }
    // A failure before this point (the store unreachable) throws, and the caller retries the
    // whole message. Once the store has answered, only the reply is retried.
    let text = this.settled.get(message.messageId);
    if (text === undefined) {
      text = await this.decide(message.body);
      this.settled.set(message.messageId, text);
    }
    await reply(text);
    this.settled.delete(message.messageId);
  }

  private async decide(body: string): Promise<string> {
    const { store } = this.options;
    const parsed = parseDecision(body);
    if (parsed === null)
      return 'I only take decisions: `approve APR-7` or `reject APR-7 <reason>`.';
    if ('error' in parsed) return parsed.error;
    const outcome = await store.decide(parsed);
    this.log(
      `decision ${parsed.decision} ${parsed.approvalId}: ${outcome.ok ? 'ok' : outcome.code}`,
    );
    if (!outcome.ok && outcome.code === 'already_decided') {
      // Also what a replayed message sees after a restart: say what the request is now.
      const current = await store.approval(parsed.approvalId);
      if (current) return `${parsed.approvalId} is already ${current.status}; nothing changed.`;
    }
    return decisionReply(parsed.approvalId, parsed.decision, outcome);
  }

  /** Daily report ask and weekly invoice nudge, when the business day or week rolls over. */
  async tickTimers(): Promise<void> {
    const { clock } = this.options;
    const now = await clock.now();
    await this.withRoomRetry(() => this.fireTimers(now));
  }

  /** Each timer's state is saved only after its post, so a failed post fires again next tick. */
  private async fireTimers(now: Date): Promise<void> {
    const { state } = this.options;
    const fires = checkTimers(now, state.get());
    if (fires.dayEnded) {
      await this.post(
        'hq',
        `@chief-of-staff \`report.daily\` · business day ${fires.dayEnded} has ended. Please post the daily company report for it here.`,
      );
    }
    state.update((s) => {
      s.businessDate = fires.businessDate;
    });
    if (fires.weekEnded) {
      await this.post(
        'finance',
        `@finance Weekly partner invoices · business week ${fires.weekEnded} has ended. Check this week's PrintHub and ShipFast invoices against our records, then verify or dispute each one.`,
      );
    }
    state.update((s) => {
      s.businessWeek = fires.businessWeek;
    });
  }

  private async post(channel: Channel, text: string): Promise<void> {
    const roomId = this.rooms[channel];
    if (!roomId) throw new MissingRoomError(channel);
    await this.options.switchHttp.postMessage(roomId, text);
  }
}

export function decisionReply(
  approvalId: string,
  decision: 'approve' | 'reject',
  outcome: DecisionOutcome,
): string {
  if (outcome.ok) {
    return decision === 'approve'
      ? `${approvalId} approved. The store ran \`${outcome.approval.action}\`.`
      : `${approvalId} rejected. The requesting department has been told.`;
  }
  switch (outcome.code) {
    case 'not_found':
      return `I can't find ${approvalId}. Check the number.`;
    case 'already_decided':
      return `${approvalId} was already decided; nothing changed.`;
    case 'action_not_supported':
      return `The store can't run ${approvalId}'s action yet, so it stays pending. You can still reject it.`;
    default:
      return `The store refused ${approvalId} (${outcome.status} ${outcome.code}); nothing changed.`;
  }
}
