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
  log?: (line: string) => void;
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

  constructor(private readonly options: GatekeeperOptions) {
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** Posts every new store event; stops at the first failure so the next poll retries it. */
  async pollEvents(): Promise<number> {
    const { store, state } = this.options;
    let posted = 0;
    for (;;) {
      const events = await store.events(state.get().eventsAfter, 100);
      if (events.length === 0) return posted;
      for (const event of events) {
        await this.deliver(event);
        state.update((s) => {
          s.eventsAfter = event.seq;
        });
        posted += 1;
      }
      if (events.length < 100) return posted;
    }
  }

  /** #events first, then the owning room with a mention, then rooms told for context. */
  async deliver(event: StoreEvent): Promise<void> {
    await this.post('events', eventsRoomLine(event));
    if (!isEventType(event.type)) return;
    const route = ROUTES[event.type];
    if (!route) return;
    const line = describeEvent(event);
    const { founderName } = this.options;

    if (event.type === 'approval.decided') {
      await this.post('approvals', line);
      const approval = await this.options.store.approval(event.payload.approvalId);
      if (approval?.department) {
        const dept = departmentRoute(approval.department);
        if (dept.room !== 'approvals') {
          await this.post(dept.room, `${mentionText(dept.mention, founderName)}${line}`);
        }
      }
      return;
    }

    const text =
      event.type === 'approval.requested'
        ? `${mentionText(route.mention, founderName)}${line}\nReply \`approve ${event.payload.approvalId}\` or \`reject ${event.payload.approvalId} <reason>\`, addressed to me.`
        : `${mentionText(route.mention, founderName)}${line}`;
    await this.post(route.room, text);
    for (const room of route.also) await this.post(room, line);
    if (event.type === 'approval.requested') {
      const dept = departmentRoute(event.payload.department);
      if (dept.room !== route.room) await this.post(dept.room, `${line} · waiting for the founder`);
    }
  }

  /** An addressed message. Only the founder, only in #approvals, only decisions. */
  async handleMessage(
    message: AddressedMessage,
    reply: (text: string) => Promise<void>,
  ): Promise<void> {
    const { rooms, founderId, store } = this.options;
    if (message.roomId !== rooms.approvals) {
      this.log(`ignored message outside #approvals from ${message.senderName}`);
      return;
    }
    if (!founderId || message.sender !== founderId) {
      this.log(`ignored message from ${message.senderName} (${message.sender}): not the founder`);
      return;
    }
    const parsed = parseDecision(message.body);
    if (parsed === null) {
      await reply('I only take decisions: `approve APR-7` or `reject APR-7 <reason>`.');
      return;
    }
    if ('error' in parsed) {
      await reply(parsed.error);
      return;
    }
    const outcome = await store.decide(parsed);
    this.log(
      `decision ${parsed.decision} ${parsed.approvalId}: ${outcome.ok ? 'ok' : outcome.code}`,
    );
    await reply(decisionReply(parsed.approvalId, parsed.decision, outcome));
  }

  /** Daily report ask and weekly invoice nudge, when the business day or week rolls over. */
  async tickTimers(): Promise<void> {
    const { clock, state } = this.options;
    const now = await clock.now();
    const fires = checkTimers(now, state.get());
    if (fires.dayEnded) {
      await this.post(
        'hq',
        `@chief-of-staff \`report.daily\` · business day ${fires.dayEnded} has ended. Please post the daily company report for it here.`,
      );
    }
    if (fires.weekEnded) {
      await this.post(
        'finance',
        `@finance Weekly partner invoices · business week ${fires.weekEnded} has ended. Check this week's PrintHub and ShipFast invoices against our records, then verify or dispute each one.`,
      );
    }
    state.update((s) => {
      s.businessDate = fires.businessDate;
      s.businessWeek = fires.businessWeek;
    });
  }

  private async post(channel: Channel, text: string): Promise<void> {
    const roomId = this.options.rooms[channel];
    if (!roomId) {
      this.log(`no room for #${channel}; skipped: ${text.split('\n')[0]}`);
      return;
    }
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
