import { describe, expect, it } from 'vitest';
import { checkTimers, istDate, istWeek } from './timers';

describe('business timers', () => {
  it('uses IST dates and ISO weeks', () => {
    expect(istDate(new Date('2026-11-06T18:29:00Z'))).toBe('2026-11-06');
    expect(istDate(new Date('2026-11-06T18:30:00Z'))).toBe('2026-11-07');
    expect(istWeek(new Date('2026-11-08T12:00:00Z'))).toBe('2026-W45'); // Sunday
    expect(istWeek(new Date('2026-11-09T00:00:00Z'))).toBe('2026-W46'); // Monday 05:30 IST
    expect(istWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });

  it('fires nothing on the first reading', () => {
    expect(
      checkTimers(new Date('2026-11-07T06:00:00Z'), { businessDate: null, businessWeek: null }),
    ).toMatchObject({
      dayEnded: null,
      weekEnded: null,
      businessDate: '2026-11-07',
      businessWeek: '2026-W45',
    });
  });

  it('fires the day (and week) that just ended', () => {
    const last = { businessDate: '2026-11-08', businessWeek: '2026-W45' };
    expect(checkTimers(new Date('2026-11-08T20:00:00Z'), last)).toMatchObject({
      dayEnded: '2026-11-08',
      weekEnded: '2026-W45',
    });
    expect(checkTimers(new Date('2026-11-08T10:00:00Z'), last)).toMatchObject({
      dayEnded: null,
      weekEnded: null,
    });
  });

  it('re-anchors without firing when the clock goes back', () => {
    const fires = checkTimers(new Date('2026-11-01T10:00:00Z'), {
      businessDate: '2026-11-08',
      businessWeek: '2026-W45',
    });
    expect(fires).toMatchObject({ dayEnded: null, weekEnded: null, businessDate: '2026-11-01' });
  });
});
