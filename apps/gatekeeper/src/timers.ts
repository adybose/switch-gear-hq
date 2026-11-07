// Business-day and business-week boundaries on the sim clock, in IST (spec: display in IST).

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** YYYY-MM-DD of `at` in IST. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO week of `at` in IST, as YYYY-Www (weeks start on Monday). */
export function istWeek(at: Date): string {
  const d = new Date(`${istDate(at)}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week decides the year.
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil((d.getTime() - yearStart) / 86_400_000 / 7 + 1 / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface TimerFires {
  /** The business day that just ended, if one did. */
  dayEnded: string | null;
  /** The business week that just ended, if one did. */
  weekEnded: string | null;
}

/**
 * Compares the clock with what the timers last saw. Nothing fires on the very first reading
 * (no previous day), and a clock that moves backwards (demo reset) just re-anchors.
 */
export function checkTimers(
  now: Date,
  last: { businessDate: string | null; businessWeek: string | null },
): TimerFires & { businessDate: string; businessWeek: string } {
  const businessDate = istDate(now);
  const businessWeek = istWeek(now);
  const dayEnded =
    last.businessDate !== null && businessDate > last.businessDate ? last.businessDate : null;
  const weekEnded =
    last.businessWeek !== null && businessWeek > last.businessWeek ? last.businessWeek : null;
  return { dayEnded, weekEnded, businessDate, businessWeek };
}
