// Gatekeeper settings, all from the environment (.env.example lists them with test values).

import { CHANNELS, type Channel } from '../routes';

export interface GatekeeperConfig {
  port: number;
  /** Store API base ending in /api/v1. */
  storeApiUrl: string;
  founderKey: string;
  simUrl: string | undefined;
  stateFile: string;
  pollMs: number;
  switch: {
    url: string;
    agentId: string;
    apiKey: string;
    founderId: string;
    founderName: string;
    roomOverrides: Partial<Record<Channel, string>>;
  } | null;
  /** Why Switch is off, when it is. */
  switchMissing: string[];
}

export function loadGatekeeperConfig(env: Record<string, string | undefined>): GatekeeperConfig {
  const storeRoot = (env.STORE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const roomOverrides: Partial<Record<Channel, string>> = {};
  for (const channel of CHANNELS) {
    const id = env[`SWITCH_ROOM_${channel.toUpperCase()}`];
    if (id) roomOverrides[channel] = id;
  }
  const required = {
    SWITCH_URL: env.SWITCH_URL ?? '',
    SWITCH_AGENT_ID: env.SWITCH_AGENT_ID ?? '',
    SWITCH_AGENT_TOKEN: env.SWITCH_AGENT_TOKEN ?? '',
    SWITCH_FOUNDER_ID: env.SWITCH_FOUNDER_ID ?? '',
  };
  const switchMissing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return {
    port: Number(env.GATEKEEPER_PORT ?? 4100),
    storeApiUrl: `${storeRoot}/api/v1`,
    founderKey: env.SG_KEY_FOUNDER ?? '',
    simUrl: env.SIM_URL || undefined,
    stateFile: env.GATEKEEPER_STATE_FILE || '.gatekeeper/state.json',
    pollMs: Number(env.GATEKEEPER_POLL_MS ?? 2000),
    switch:
      switchMissing.length === 0
        ? {
            url: required.SWITCH_URL,
            agentId: required.SWITCH_AGENT_ID,
            apiKey: required.SWITCH_AGENT_TOKEN,
            founderId: required.SWITCH_FOUNDER_ID,
            founderName: env.SWITCH_FOUNDER_NAME ?? '',
            roomOverrides,
          }
        : null,
    switchMissing,
  };
}
