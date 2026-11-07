// Gatekeeper's memory between runs: the store event cursor, the Switch connection position
// and the last business day/week the timers fired for. One small JSON file, written atomically.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface GatekeeperState {
  /** Highest store event seq already posted. */
  eventsAfter: number;
  switch: { connectionId: string; generation: number | null; cursor: number | null };
  /** Business date (IST, YYYY-MM-DD) the daily timer last saw. */
  businessDate: string | null;
  /** Business ISO week (IST, YYYY-Www) the weekly timer last saw. */
  businessWeek: string | null;
}

export function initialState(): GatekeeperState {
  return {
    eventsAfter: 0,
    switch: { connectionId: randomUUID(), generation: null, cursor: null },
    businessDate: null,
    businessWeek: null,
  };
}

export interface StateStore {
  get(): GatekeeperState;
  update(change: (state: GatekeeperState) => void): void;
}

/** In memory only; for tests. */
export function memoryState(start: GatekeeperState = initialState()): StateStore {
  const state = structuredClone(start);
  return { get: () => state, update: (change) => change(state) };
}

export function fileState(path: string): StateStore {
  let state = initialState();
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Partial<GatekeeperState>;
    state = { ...state, ...saved, switch: { ...state.switch, ...saved.switch } };
  } catch {
    // First run (or an unreadable file): start fresh, and save the new connection id now.
  }
  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, path);
  };
  save();
  return {
    get: () => state,
    update(change) {
      change(state);
      save();
    },
  };
}
