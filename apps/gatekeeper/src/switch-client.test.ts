import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  createSwitchHttp,
  openConnection,
  type AddressedMessage,
  type ConnectionPosition,
  type SwitchConnection,
} from './switch-client';

// A fake Switch agent bridge: records each socket open and lets the test drive frames.
function fakeBridge() {
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  const opens: { url: URL; auth: string | undefined; socket: WebSocket; received: unknown[] }[] =
    [];
  const waiters: (() => void)[] = [];
  wss.on('connection', (socket, req: IncomingMessage) => {
    const open = {
      url: new URL(req.url!, 'http://x'),
      auth: req.headers.authorization,
      socket,
      received: [] as unknown[],
    };
    socket.on('message', (raw) => open.received.push(JSON.parse(raw.toString())));
    opens.push(open);
    waiters.splice(0).forEach((w) => w());
  });
  return {
    opens,
    async start(): Promise<string> {
      await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    },
    async nextOpen(count: number): Promise<(typeof opens)[number]> {
      while (opens.length < count) await new Promise<void>((r) => waiters.push(r));
      return opens[count - 1]!;
    },
    async stop() {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const send = (socket: WebSocket, frame: unknown) => socket.send(JSON.stringify(frame));
const msg = (id: number, payload: Record<string, unknown>) => ({
  event: 'message',
  id,
  data: {
    type: 'message',
    room_id: 'r-approvals',
    bridge_id: null,
    channel_type: null,
    sequence: id,
    payload,
  },
});

describe('Switch connection', () => {
  let bridge: ReturnType<typeof fakeBridge>;
  let conn: SwitchConnection | undefined;
  afterEach(async () => {
    conn?.close();
    await bridge.stop();
  });

  async function connect(position: ConnectionPosition) {
    bridge = fakeBridge();
    const base = await bridge.start();
    const handled: AddressedMessage[] = [];
    const positions: ConnectionPosition[] = [];
    conn = openConnection({
      baseUrl: base,
      agentId: 'agent-1',
      apiKey: 'agent-key',
      roomId: 'r-approvals',
      position,
      backoffMs: [10],
      onMessage: async (m) => void handled.push(m),
      onPosition: (p) => positions.push(p),
    });
    return { handled, positions };
  }

  it('opens with a stable connection id and the room, answers pings with its cursor, and acts only on addressed messages', async () => {
    const { handled, positions } = await connect({
      connectionId: 'conn-1',
      generation: null,
      cursor: null,
    });
    const open = await bridge.nextOpen(1);
    expect(open.auth).toBe('Bearer agent-key');
    expect(open.url.pathname).toBe('/agents/agent-1/connection/ws');
    expect(Object.fromEntries(open.url.searchParams)).toMatchObject({
      connection_id: 'conn-1',
      rooms: 'r-approvals',
      scope: 'single',
      filter: 'addressed',
      start_from: 'head',
    });
    expect(open.url.searchParams.has('expected_generation')).toBe(false);

    send(open.socket, {
      event: 'connection_state',
      data: { generation: 3, cursor: 10, rooms: ['r-approvals'] },
    });
    await conn!.ready;
    send(open.socket, { event: 'ping', data: {} });
    await until(() => open.received.length === 1);
    expect(open.received[0]).toEqual({ type: 'pong', cursor: 10 });

    send(open.socket, msg(11, { addressed: false, body: 'chatter', sender: 's' }));
    send(
      open.socket,
      msg(12, {
        addressed: true,
        body: 'approve APR-7',
        sender: '@f:x',
        sender_name: 'founder',
        message_id: 'm12',
        thread_id: null,
      }),
    );
    await until(() => positions.at(-1)?.cursor === 12);
    expect(handled).toEqual([
      {
        roomId: 'r-approvals',
        sender: '@f:x',
        senderName: 'founder',
        messageId: 'm12',
        threadId: null,
        body: 'approve APR-7',
      },
    ]);
    send(open.socket, { event: 'ping', data: {} });
    await until(() => open.received.length === 2);
    expect(open.received[1]).toEqual({ type: 'pong', cursor: 12 });
  });

  it('resumes after a drop with the same connection id, its cursor and generation', async () => {
    const { positions } = await connect({ connectionId: 'conn-2', generation: 4, cursor: 20 });
    const first = await bridge.nextOpen(1);
    expect(first.url.searchParams.get('start_from')).toBe('20');
    expect(first.url.searchParams.get('expected_generation')).toBe('4');
    send(first.socket, { event: 'connection_state', data: { generation: 5, cursor: 20 } });
    send(first.socket, msg(21, { addressed: false, body: 'x' }));
    await until(() => positions.at(-1)?.cursor === 21);
    first.socket.terminate();

    const second = await bridge.nextOpen(2);
    expect(Object.fromEntries(second.url.searchParams)).toMatchObject({
      connection_id: 'conn-2',
      start_from: '21',
      expected_generation: '5',
    });
  });

  it('takes the cursor from a gap frame', async () => {
    const { positions } = await connect({ connectionId: 'conn-3', generation: 1, cursor: 2 });
    const open = await bridge.nextOpen(1);
    send(open.socket, { event: 'gap', data: { resumed_at: 90, reason: 'retention' } });
    await until(() => positions.at(-1)?.cursor === 90);
  });

  it('stops for good when taken over', async () => {
    await connect({ connectionId: 'conn-4', generation: 1, cursor: 0 });
    const open = await bridge.nextOpen(1);
    send(open.socket, { event: 'evicted', data: { code: 'taken_over', reason: 'another open' } });
    open.socket.close(1000);
    await until(() => conn!.stopped);
    await new Promise((r) => setTimeout(r, 50));
    expect(bridge.opens).toHaveLength(1);
  });

  it('reconnects after a heartbeat lapse', async () => {
    await connect({ connectionId: 'conn-5', generation: 1, cursor: 0 });
    const open = await bridge.nextOpen(1);
    send(open.socket, { event: 'evicted', data: { code: 'heartbeat_lapsed' } });
    open.socket.close(1000);
    await bridge.nextOpen(2);
    expect(conn!.stopped).toBe(false);
  });
});

describe('Switch HTTP', () => {
  it('posts messages, lists rooms and replies in a thread with the connection id', async () => {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      });
      const result = url.endsWith('/ops/list_rooms')
        ? { result: [{ room_id: 'r1', name: 'switch-gear-hq: events' }, { bad: true }] }
        : { ok: true };
      return new Response(JSON.stringify(result), { status: 200 });
    }) as typeof fetch;
    const http = createSwitchHttp({
      baseUrl: 'https://switch.test/',
      agentId: 'a1',
      apiKey: 'k',
      fetch: fakeFetch,
    });

    expect(await http.listRooms()).toEqual([{ roomId: 'r1', name: 'switch-gear-hq: events' }]);
    await http.postMessage('r1', '@finance hello');
    await http.replyInRoom('conn-1', 'APR-7 approved.', 'm12');

    expect(calls.map((c) => c.url)).toEqual([
      'https://switch.test/agents/a1/ops/list_rooms',
      'https://switch.test/agents/a1/message',
      'https://switch.test/agents/a1/ops/post_message',
    ]);
    expect(calls[1]!.body).toEqual({ room_id: 'r1', content: '@finance hello' });
    expect(calls[2]!.body).toEqual({ body: 'APR-7 approved.', thread_id: 'm12' });
    expect(calls[2]!.headers['x-switch-connection-id']).toBe('conn-1');
    expect(calls.every((c) => c.headers.authorization === 'Bearer k')).toBe(true);
  });

  it('throws on a refused call so the event is retried', async () => {
    const fakeFetch = (async () =>
      new Response('nope', { status: 403 })) as unknown as typeof fetch;
    const http = createSwitchHttp({
      baseUrl: 'https://switch.test',
      agentId: 'a1',
      apiKey: 'k',
      fetch: fakeFetch,
    });
    await expect(http.postMessage('r1', 'x')).rejects.toThrow('403');
  });
});
