import { describe, expect, it } from 'vitest';
import { parseDecision } from './approvals';

describe('parseDecision', () => {
  it('reads approve and reject, after any leading mentions', () => {
    expect(parseDecision('approve APR-7')).toEqual({ decision: 'approve', approvalId: 'APR-7' });
    expect(parseDecision('@gatekeeper approve apr-12')).toEqual({
      decision: 'approve',
      approvalId: 'APR-12',
    });
    expect(parseDecision('@gatekeeper: Reject APR-3 too generous, offer 50%')).toEqual({
      decision: 'reject',
      approvalId: 'APR-3',
      reason: 'too generous, offer 50%',
    });
  });

  it('returns null for anything that is not a decision', () => {
    expect(parseDecision('@gatekeeper what is pending?')).toBeNull();
    expect(parseDecision('approved APR-7')).toBeNull();
    expect(parseDecision('please approve APR-7')).toBeNull();
  });

  it('explains incomplete decisions', () => {
    expect(parseDecision('approve')).toEqual({ error: expect.stringContaining('APR-7') });
    expect(parseDecision('reject APR-9')).toEqual({ error: expect.stringContaining('reason') });
    expect(parseDecision(`reject APR-9 ${'x'.repeat(501)}`)).toEqual({
      error: expect.stringContaining('500'),
    });
  });
});
