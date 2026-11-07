import { existsSync } from 'node:fs';
import { createClock } from '@switch-gear/shared';
import { loadGatekeeperConfig } from './config';
import { Gatekeeper, resolveRooms } from './gatekeeper';
import { createHealthServer } from './health';
import { fileState } from './state';
import { createStoreClient } from './store-client';
import { createSwitchHttp, openConnection } from './switch-client';

// Locally, pick up .env and the seeded department keys (SG_KEY_FOUNDER). In Docker the
// environment is set by compose and these files are absent.
for (const file of ['.env', '.env.local.keys', '../../.env', '../../.env.local.keys']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const config = loadGatekeeperConfig(process.env);
const log = (line: string) => console.log(`[gatekeeper] ${line}`);

createHealthServer().listen(config.port, '0.0.0.0', () => log(`health on :${config.port}`));

async function main(): Promise<void> {
  if (!config.switch) {
    log(`Switch is not configured (missing ${config.switchMissing.join(', ')}); health only.`);
    return;
  }
  if (!config.founderKey) {
    log('SG_KEY_FOUNDER is not set (run npm run db:seed); health only.');
    return;
  }
  const sw = config.switch;
  const state = fileState(config.stateFile);
  const switchHttp = createSwitchHttp({ baseUrl: sw.url, agentId: sw.agentId, apiKey: sw.apiKey });
  const rooms = resolveRooms(await switchHttp.listRooms(), sw.roomOverrides);
  log(`rooms: ${JSON.stringify(rooms)}`);

  const gatekeeper = new Gatekeeper({
    store: createStoreClient({ baseUrl: config.storeApiUrl, founderKey: config.founderKey }),
    switchHttp,
    clock: createClock({ simUrl: config.simUrl }),
    state,
    founderId: sw.founderId,
    founderName: sw.founderName,
    rooms,
    refreshRooms: async () => {
      const fresh = resolveRooms(await switchHttp.listRooms(), sw.roomOverrides);
      log(`rooms looked up again: ${JSON.stringify(fresh)}`);
      return fresh;
    },
    log,
  });

  if (rooms.approvals) {
    const connection = openConnection({
      baseUrl: sw.url,
      agentId: sw.agentId,
      apiKey: sw.apiKey,
      roomId: rooms.approvals,
      position: state.get().switch,
      log,
      onPosition: (p) => state.update((s) => void (s.switch = p)),
      onMessage: (message) =>
        gatekeeper.handleMessage(message, (text) =>
          switchHttp.replyInRoom(
            state.get().switch.connectionId,
            text,
            message.threadId ?? message.messageId,
          ),
        ),
    });
    const shutdown = () => {
      connection.close();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } else {
    log('no #approvals room: founder decisions are off until Gatekeeper is added to it.');
  }

  // One loop, never overlapping: events every poll, timers right after.
  for (;;) {
    try {
      const posted = await gatekeeper.pollEvents();
      if (posted) log(`posted ${posted} events (cursor ${state.get().eventsAfter})`);
    } catch (err) {
      log(`event poll failed: ${(err as Error).message}`);
    }
    try {
      await gatekeeper.tickTimers();
    } catch (err) {
      log(`timers failed: ${(err as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

main().catch((err: Error) => {
  log(`fatal: ${err.message}`);
  process.exit(1);
});
