// Switch agent protocol client (https://docs.switchagents.ai/switch-rooms/internals/agent-protocol.md).
//
// - HTTP: `POST /agents/{id}/message` posts to any room the agent belongs to, no connection
//   needed. Operations (`POST /agents/{id}/ops/{op}`) carry the connection id header; Gatekeeper
//   uses `list_rooms` (no room needed) and `post_message` (to reply in a thread in its room).
// - WebSocket: one connection with a stable connection id, claiming one room (#approvals) on
//   open. Every ping is answered at once with the cursor; drops are resumed from the cursor and
//   generation; `taken_over` is final. Only `message` events with `addressed: true` reach the
//   handler. A handler that throws is retried, and the cursor does not move past it until it
//   succeeds, so a restart replays the message rather than dropping it.

import WebSocket from 'ws';

export interface SwitchRoom {
  roomId: string;
  name: string;
}

export interface AddressedMessage {
  roomId: string;
  sender: string;
  senderName: string;
  messageId: string;
  threadId: string | null;
  body: string;
}

export interface SwitchHttp {
  listRooms(): Promise<SwitchRoom[]>;
  /** Top-level post to any room the agent is in. Mentions in the text address those names. */
  postMessage(roomId: string, content: string): Promise<void>;
  /** Post in the connection's room, optionally into a thread. */
  replyInRoom(connectionId: string, body: string, threadId: string | null): Promise<void>;
}

export class SwitchHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createSwitchHttp(options: {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}): SwitchHttp {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = `${options.baseUrl.replace(/\/+$/, '')}/agents/${encodeURIComponent(options.agentId)}`;

  async function post(
    path: string,
    body: unknown,
    extra: Record<string, string> = {},
  ): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        ...extra,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok)
      throw new SwitchHttpError(`POST ${path} → ${res.status} ${text.slice(0, 200)}`, res.status);
    return text ? (JSON.parse(text) as unknown) : null;
  }

  return {
    async listRooms() {
      const json = (await post('/ops/list_rooms', {})) as { result?: unknown } | null;
      const list = Array.isArray(json?.result) ? json.result : [];
      return list
        .filter(
          (r): r is { room_id: string; name: string } =>
            typeof r?.room_id === 'string' && typeof r?.name === 'string',
        )
        .map((r) => ({ roomId: r.room_id, name: r.name }));
    },
    async postMessage(roomId, content) {
      await post('/message', { room_id: roomId, content });
    },
    async replyInRoom(connectionId, body, threadId) {
      await post('/ops/post_message', threadId ? { body, thread_id: threadId } : { body }, {
        'x-switch-connection-id': connectionId,
      });
    },
  };
}

/** Where the connection resumes from; persisted by the caller between runs. */
export interface ConnectionPosition {
  connectionId: string;
  generation: number | null;
  cursor: number | null;
}

export interface ConnectionOptions {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  roomId: string;
  position: ConnectionPosition;
  onMessage: (message: AddressedMessage) => Promise<void>;
  /** Called when the cursor or generation moves, so the caller can save them. */
  onPosition: (position: ConnectionPosition) => void;
  log?: (line: string) => void;
  /** Reconnect delays in ms; the last one repeats. */
  backoffMs?: number[];
  /** Delays before retrying a message whose handler failed; the last one repeats. */
  retryMs?: number[];
  createSocket?: (url: string, headers: Record<string, string>) => WebSocket;
}

export interface SwitchConnection {
  /** Resolves once the first connection_state arrives. */
  ready: Promise<void>;
  close(): void;
  /** True after `taken_over` or a permanent close: the connection will not reopen. */
  readonly stopped: boolean;
}

type Frame = {
  event?: string;
  type?: string;
  data?: Record<string, unknown>;
  id?: number;
} & Record<string, unknown>;

export function openConnection(options: ConnectionOptions): SwitchConnection {
  const log = options.log ?? (() => {});
  const backoff = options.backoffMs ?? [1000, 2000, 5000, 10_000];
  const createSocket =
    options.createSocket ??
    ((url: string, headers: Record<string, string>) => new WebSocket(url, { headers }));
  const position: ConnectionPosition = { ...options.position };
  let socket: WebSocket | null = null;
  let closedByUs = false;
  let stopped = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | null = null;
  // Events are handled one at a time, in order, behind the pings.
  let queue: Promise<void> = Promise.resolve();
  let enqueuedUpTo = -1;
  const retry = options.retryMs ?? [1000, 2000, 5000, 10_000, 30_000];
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => (markReady = resolve));

  function url(): string {
    const wsBase = options.baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws');
    const params = new URLSearchParams({
      connection_id: position.connectionId,
      scope: 'single',
      filter: 'addressed',
      rooms: options.roomId,
      start_from: position.cursor === null ? 'head' : String(position.cursor),
      client: 'switch-gear-gatekeeper',
      client_version: '1.0.0',
    });
    if (position.generation !== null)
      params.set('expected_generation', String(position.generation));
    return `${wsBase}/agents/${encodeURIComponent(options.agentId)}/connection/ws?${params}`;
  }

  function stop(reason: string): void {
    stopped = true;
    log(`switch connection stopped: ${reason}`);
  }

  function scheduleReconnect(): void {
    if (closedByUs || stopped || timer) return;
    const delay = backoff[Math.min(attempt, backoff.length - 1)]!;
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
  }

  function handle(frame: Frame): void {
    const kind = frame.event ?? frame.type;
    switch (kind) {
      case 'ping':
        // Answer first, before any queued event work.
        socket?.send(JSON.stringify({ type: 'pong', cursor: position.cursor ?? 0 }));
        return;
      case 'connection_state': {
        const data = (frame.data ?? frame) as Record<string, unknown>;
        attempt = 0;
        if (typeof data.generation === 'number') position.generation = data.generation;
        if (typeof data.cursor === 'number') position.cursor = data.cursor;
        options.onPosition({ ...position });
        log(
          `switch connected: rooms ${JSON.stringify(data.rooms ?? [])}, cursor ${position.cursor}`,
        );
        markReady();
        return;
      }
      case 'gap': {
        const data = (frame.data ?? frame) as Record<string, unknown>;
        if (typeof data.resumed_at === 'number') position.cursor = data.resumed_at;
        options.onPosition({ ...position });
        log(
          `switch gap: ${String(data.reason ?? 'unknown')}; some messages to Gatekeeper were missed`,
        );
        return;
      }
      case 'evicted': {
        const data = (frame.data ?? frame) as Record<string, unknown>;
        const code = String(data.code ?? '');
        if (code === 'taken_over') stop('taken over by another connection');
        else if (code === 'closed') stop(`closed by the server: ${String(data.reason ?? '')}`);
        return;
      }
      case 'refused': {
        const data = (frame.data ?? frame) as Record<string, unknown>;
        log(`switch refused the connection: ${String(data.status)} ${String(data.detail ?? '')}`);
        return;
      }
      case 'message': {
        const seq = typeof frame.id === 'number' ? frame.id : null;
        if (!claim(seq)) return;
        const data = frame.data ?? {};
        const payload = (data.payload ?? {}) as Record<string, unknown>;
        queue = queue.then(async () => {
          if (payload.addressed === true && typeof payload.body === 'string') {
            const message: AddressedMessage = {
              roomId: String(data.room_id ?? ''),
              sender: String(payload.sender ?? ''),
              senderName: String(payload.sender_name ?? ''),
              messageId: String(payload.message_id ?? ''),
              threadId: typeof payload.thread_id === 'string' ? payload.thread_id : null,
              body: payload.body,
            };
            // Retry until it works. The cursor (and every later event) waits behind it, so a
            // restart replays it; pings are answered outside this queue meanwhile.
            for (let failures = 0; ; failures += 1) {
              if (closedByUs || stopped) return;
              try {
                await options.onMessage(message);
                break;
              } catch (err) {
                const delay = retry[Math.min(failures, retry.length - 1)]!;
                log(
                  `switch message ${message.messageId} failed, retrying in ${delay} ms: ${(err as Error).message}`,
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            }
          }
          advance(seq);
        });
        return;
      }
      default: {
        // command, room_join, subscription_changed, room_released: nothing to act on, but a
        // domain event still moves the cursor.
        const seq = typeof frame.id === 'number' ? frame.id : null;
        if (seq !== null && claim(seq)) queue = queue.then(() => advance(seq));
      }
    }
  }

  /**
   * True the first time an event is seen. After a reconnect the server replays everything past
   * the cursor, which can include events still waiting in the queue; those are not run twice.
   */
  function claim(seq: number | null): boolean {
    if (seq === null) return true;
    const seen = Math.max(enqueuedUpTo, position.cursor ?? -1);
    if (seq <= seen) return false;
    enqueuedUpTo = seq;
    return true;
  }

  function advance(seq: number | null): void {
    if (seq === null || (position.cursor !== null && seq <= position.cursor)) return;
    position.cursor = seq;
    options.onPosition({ ...position });
  }

  function connect(): void {
    if (closedByUs || stopped) return;
    const ws = createSocket(url(), { authorization: `Bearer ${options.apiKey}` });
    socket = ws;
    ws.on('message', (raw) => {
      let frame: Frame;
      try {
        frame = JSON.parse(raw.toString()) as Frame;
      } catch {
        return;
      }
      handle(frame);
    });
    ws.on('close', (code) => {
      if (socket === ws) socket = null;
      // 4401: bad key. 4403: room can't be served. 4409 covers taken_over and room claims; an
      // evicted frame has already said which. All of these need a person, not a retry.
      if (code === 4401 || code === 4403) stop(`closed with ${code}`);
      else if (code === 4409 && position.generation !== null) stop('closed with 4409 (taken over)');
      if (!stopped) log(`switch socket closed (${code}); reconnecting`);
      scheduleReconnect();
    });
    ws.on('error', (err) => log(`switch socket error: ${err.message}`));
  }

  connect();

  return {
    ready,
    close() {
      closedByUs = true;
      if (timer) clearTimeout(timer);
      socket?.close(1000);
    },
    get stopped() {
      return stopped;
    },
  };
}
