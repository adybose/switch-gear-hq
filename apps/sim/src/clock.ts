// Shared business clock. Speed changes preserve the current business instant.

export interface SimClock {
  now(): Date;
  /** Business seconds per real second. */
  speed(): number;
  onSpeedChange?(listener: () => void): () => void;
}

export interface MutableSimClock extends SimClock {
  setSpeed(speed: number): void;
}

export function createSimClock(speed = Number(process.env.SIM_CLOCK_SPEED) || 1): MutableSimClock {
  const listeners = new Set<() => void>();
  let baseReal = Date.now();
  let baseBusiness = baseReal;
  const validate = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Clock speed must be positive');
  };
  validate(speed);
  const now = () => new Date(baseBusiness + (Date.now() - baseReal) * speed);
  return {
    onSpeedChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    now,
    speed: () => speed,
    setSpeed: (next) => {
      validate(next);
      baseBusiness = now().getTime();
      baseReal = Date.now();
      speed = next;
      for (const listener of listeners) listener();
    },
  };
}

/** Real milliseconds until `businessMs` of business time has passed. */
export function realDelayMs(clock: SimClock, businessMs: number): number {
  return Math.max(0, businessMs / clock.speed());
}
