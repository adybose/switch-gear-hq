import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook, webhookSecretEnv } from './webhooks';

const SECRET = 'test_paymock_secret';
const BODY =
  '{"eventId":"evt_1","type":"payment.captured","occurredAt":"2026-11-07T10:00:00Z","data":{}}';

describe('webhook signatures', () => {
  it('signs as sha256=<hex HMAC of the raw body>', () => {
    expect(signWebhook(SECRET, BODY)).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signWebhook(SECRET, BODY)).toBe(signWebhook(SECRET, BODY));
  });

  it('verifies the right signature only', () => {
    const header = signWebhook(SECRET, BODY);
    expect(verifyWebhook(SECRET, BODY, header)).toBe(true);
    expect(verifyWebhook(SECRET, BODY, ` ${header} `)).toBe(true);
    expect(verifyWebhook('other_secret', BODY, header)).toBe(false);
    expect(verifyWebhook(SECRET, `${BODY} `, header)).toBe(false); // any byte change
    expect(verifyWebhook(SECRET, BODY, header.replace('sha256=', ''))).toBe(false);
    expect(verifyWebhook(SECRET, BODY, null)).toBe(false);
    expect(verifyWebhook('', BODY, signWebhook('', BODY))).toBe(false); // no secret, no trust
  });

  it('names each partner secret env var', () => {
    expect(webhookSecretEnv('shipfast')).toBe('SHIPFAST_WEBHOOK_SECRET');
  });
});
