import { describe, expect, it, vi } from 'vitest';
import { createClock } from './clock';

const REAL_START = Date.parse('2026-11-07T00:00:00.000Z');
const SIM_NOW = '2026-12-01T09:00:00.000Z';

function fakeTime(start = REAL_START) {
  let ms = start;
  return { now: () => ms, advance: (by: number) => (ms += by) };
}

function simResponse(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('business clock', () => {
  it('is real time without a sim URL', async () => {
    const time = fakeTime();
    const fetch = vi.fn();
    const clock = createClock({ realNow: time.now, fetch });
    expect(await clock.read()).toEqual({ now: new Date(REAL_START), speed: 1, source: 'real' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads business time from the sim', async () => {
    const time = fakeTime();
    const fetch = simResponse({ now: SIM_NOW, speed: 144 });
    const clock = createClock({ simUrl: 'http://sim:4000', realNow: time.now, fetch });

    expect(await clock.read()).toEqual({ now: new Date(SIM_NOW), speed: 144, source: 'sim' });
    expect(fetch).toHaveBeenCalledWith(new URL('http://sim:4000/sim/clock'), expect.anything());
  });

  it('runs the last reading forward at sim speed between refreshes', async () => {
    const time = fakeTime();
    const fetch = simResponse({ now: SIM_NOW, speed: 144 }); // 1 business day = 10 min
    const clock = createClock({ simUrl: 'http://sim', refreshMs: 5000, realNow: time.now, fetch });

    await clock.read();
    time.advance(1000);
    expect((await clock.now()).toISOString()).toBe('2026-12-01T09:02:24.000Z');
    expect(fetch).toHaveBeenCalledTimes(1);

    time.advance(4000);
    await clock.read();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('makes concurrent reads wait for the same in-flight sync', async () => {
    const time = fakeTime();
    let respond: (res: Response) => void = () => {};
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    const clock = createClock({ simUrl: 'http://sim', realNow: time.now, fetch });

    const first = clock.read();
    const second = clock.read();
    respond(new Response(JSON.stringify({ now: SIM_NOW, speed: 144 })));

    const expected = { now: new Date(SIM_NOW), speed: 144, source: 'sim' };
    expect(await first).toEqual(expected);
    expect(await second).toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to real time when the sim is down', async () => {
    const time = fakeTime();
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const clock = createClock({ simUrl: 'http://sim', realNow: time.now, fetch });
    expect(await clock.read()).toEqual({ now: new Date(REAL_START), speed: 1, source: 'real' });
  });

  it('falls back to real time on an error status or a bad body', async () => {
    const time = fakeTime();
    for (const fetch of [
      simResponse({ error: 'not_found' }, 404),
      simResponse({ now: 'yesterday', speed: 1 }),
      simResponse({ now: SIM_NOW, speed: 0 }),
    ]) {
      const clock = createClock({ simUrl: 'http://sim', realNow: time.now, fetch });
      expect((await clock.read()).source).toBe('real');
    }
  });

  it('goes back to real time if the sim stops answering, and recovers', async () => {
    const time = fakeTime();
    let up = true;
    const fetch = vi.fn(async () => {
      if (!up) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ now: SIM_NOW, speed: 1 }));
    });
    const clock = createClock({ simUrl: 'http://sim', refreshMs: 1000, realNow: time.now, fetch });

    expect((await clock.read()).source).toBe('sim');
    up = false;
    time.advance(1000);
    expect((await clock.read()).source).toBe('real');
    up = true;
    time.advance(1000);
    expect((await clock.read()).source).toBe('sim');
  });
});
