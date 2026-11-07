import { businessNow } from '@switch-gear/shared/clock';
import { getDb } from './db';
import { cancelUnpaidOrders } from './paymock';

// Background timers in the store process. Each tick reads business time from the sim clock.

const EVERY_MS = 5000;
const globalForTimers = globalThis as unknown as { sgTimers?: NodeJS.Timeout };

async function tick(): Promise<void> {
  const cancelled = await cancelUnpaidOrders(getDb(), await businessNow());
  if (cancelled.length > 0) console.log(`[timers] cancelled unpaid: ${cancelled.join(', ')}`);
}

export function startTimers(): void {
  if (globalForTimers.sgTimers || !process.env.DATABASE_URL) return;
  let running = false;
  globalForTimers.sgTimers = setInterval(() => {
    if (running) return;
    running = true;
    tick()
      .catch((err: unknown) => console.error('[timers] tick failed', err))
      .finally(() => {
        running = false;
      });
  }, EVERY_MS);
  globalForTimers.sgTimers.unref();
}
