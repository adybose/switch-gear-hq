// Business time. The sim owns it (GET /sim/clock → { now, speed }); speed 1 is real time,
// demo speed runs one business day in ten minutes. When the sim can't be reached the clock
// falls back to real time, so the store keeps working without it.

export interface ClockReading {
  now: Date;
  /** Business seconds per real second. */
  speed: number;
  source: 'sim' | 'real';
}

export interface BusinessClock {
  read(): Promise<ClockReading>;
  /** Shorthand for `(await read()).now`. */
  now(): Promise<Date>;
}

export interface ClockOptions {
  /** Sim base URL, e.g. http://localhost:4000. Without one the clock is real time. */
  simUrl?: string;
  /** Re-read the sim this often; in between, run the last reading forward. Default 5 s. */
  refreshMs?: number;
  /** Give up on a sim request after this long. Default 500 ms. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof globalThis.fetch;
  /** For tests: real time in ms. */
  realNow?: () => number;
}

interface SimClockResponse {
  now: string;
  speed: number;
}

function isSimClockResponse(body: unknown): body is SimClockResponse {
  if (body === null || typeof body !== 'object') return false;
  const { now, speed } = body as Record<string, unknown>;
  return (
    typeof now === 'string' &&
    !Number.isNaN(Date.parse(now)) &&
    typeof speed === 'number' &&
    Number.isFinite(speed) &&
    speed > 0
  );
}

export function createClock(options: ClockOptions = {}): BusinessClock {
  const refreshMs = options.refreshMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 500;
  const doFetch = options.fetch ?? globalThis.fetch;
  const realNow = options.realNow ?? Date.now;

  // Last good sim reading, and the real time it was taken.
  let synced: { businessMs: number; realMs: number; speed: number } | undefined;
  let lastAttemptMs = Number.NEGATIVE_INFINITY;

  async function sync(): Promise<void> {
    if (!options.simUrl) return;
    lastAttemptMs = realNow();
    try {
      const res = await doFetch(new URL('/sim/clock', options.simUrl), {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body: unknown = res.ok ? await res.json() : undefined;
      synced = isSimClockResponse(body)
        ? { businessMs: Date.parse(body.now), realMs: realNow(), speed: body.speed }
        : undefined;
    } catch {
      synced = undefined;
    }
  }

  async function read(): Promise<ClockReading> {
    if (realNow() - lastAttemptMs >= refreshMs) await sync();
    const real = realNow();
    if (!synced) return { now: new Date(real), speed: 1, source: 'real' };
    const businessMs = synced.businessMs + (real - synced.realMs) * synced.speed;
    return { now: new Date(businessMs), speed: synced.speed, source: 'sim' };
  }

  return { read, now: async () => (await read()).now };
}

let defaultClock: BusinessClock | undefined;

/** Process-wide clock reading the sim at SIM_URL. */
export function businessClock(): BusinessClock {
  defaultClock ??= createClock({ simUrl: process.env.SIM_URL });
  return defaultClock;
}

/** Current business time (sim clock, or real time if the sim is unavailable). */
export function businessNow(): Promise<Date> {
  return businessClock().now();
}
