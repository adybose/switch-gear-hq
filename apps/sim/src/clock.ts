// The sim's business clock. For now it runs at a fixed speed from SIM_CLOCK_SPEED (default 1,
// real time). T-15 adds GET /sim/clock, the demo speed control and shares it with the store.

export interface SimClock {
  now(): Date;
  /** Business seconds per real second. */
  speed(): number;
}

export function createSimClock(speed = Number(process.env.SIM_CLOCK_SPEED) || 1): SimClock {
  const startReal = Date.now();
  return {
    now: () => new Date(startReal + (Date.now() - startReal) * speed),
    speed: () => speed,
  };
}

/** Real milliseconds until `businessMs` of business time has passed. */
export function realDelayMs(clock: SimClock, businessMs: number): number {
  return Math.max(0, businessMs / clock.speed());
}
