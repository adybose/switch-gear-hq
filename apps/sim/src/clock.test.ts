import { afterEach, expect, it, vi } from 'vitest';
import { createSimClock } from './clock';

afterEach(() => vi.useRealTimers());
it('changes speed continuously: ten real minutes at 144× is one business day', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T00:00:00Z'));
  const clock = createSimClock(1);
  vi.advanceTimersByTime(1000);
  clock.setSpeed(144);
  expect(clock.now().toISOString()).toBe('2026-11-07T00:00:01.000Z');
  vi.advanceTimersByTime(600_000);
  expect(clock.now().toISOString()).toBe('2026-11-08T00:00:01.000Z');
  clock.setSpeed(1);
  vi.advanceTimersByTime(1000);
  expect(clock.now().toISOString()).toBe('2026-11-08T00:00:02.000Z');
  for (const speed of [0, -1, NaN, Infinity]) expect(() => clock.setSpeed(speed)).toThrow();
  expect(clock.speed()).toBe(1);
});

it('notifies pending work at a speed change and permits unsubscribing', () => {
  const clock = createSimClock(1);
  const listener = vi.fn();
  const unsubscribe = clock.onSpeedChange!(listener);
  clock.setSpeed(144);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  clock.setSpeed(1);
  expect(listener).toHaveBeenCalledTimes(1);
});
