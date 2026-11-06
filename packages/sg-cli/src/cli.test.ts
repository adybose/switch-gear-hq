import { describe, expect, it } from 'vitest';
import { HELP, run } from './cli';

describe('sg cli', () => {
  it('prints help with no arguments', () => {
    expect(run([])).toEqual({ code: 0, out: HELP });
  });

  it('fails on an unknown command', () => {
    const result = run(['nope']);
    expect(result.code).toBe(1);
    expect(result.out).toContain("unknown command 'nope'");
  });
});
