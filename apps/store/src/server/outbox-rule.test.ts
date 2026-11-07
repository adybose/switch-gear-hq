import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AGENTS.md: every state change to an order, payment, print job, shipment or refund goes
// through a service function that also writes an Event. Route handlers and pages must not
// write those tables themselves.

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));
const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url));
const MODELS = 'order|orderItem|payment|printJob|shipment|refund';
const WRITE = new RegExp(
  `\\.(${MODELS})\\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\\(`,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('outbox rule', () => {
  it('route handlers and pages never write order, payment, print job, shipment or refund tables', () => {
    const offenders = sourceFiles(APP_DIR).filter((f) => WRITE.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every server module that writes those tables also records an event', () => {
    const writers = sourceFiles(SERVER_DIR).filter((f) => WRITE.test(readFileSync(f, 'utf8')));
    expect(writers.length).toBeGreaterThan(0); // checkout.ts at least
    const silent = writers.filter((f) => !readFileSync(f, 'utf8').includes('recordEvent('));
    expect(silent).toEqual([]);
  });
});
