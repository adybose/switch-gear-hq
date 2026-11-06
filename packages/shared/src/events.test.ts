import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { EVENT_TYPES, isEventType, type EventType, type StoreEvent } from './events';

const spec = readFileSync(fileURLToPath(new URL('../../../docs/spec.md', import.meta.url)), 'utf8');

/** Event names in the spec §10 table, e.g. `order.paid` or `shipment.failed`, `shipment.rto`. */
function specEventNames(): string[] {
  const section = spec.split('## 10. Business events')[1]?.split('\n## ')[0] ?? '';
  const names: string[] = [];
  for (const line of section.split('\n')) {
    const firstCell = line.split('|')[1] ?? '';
    for (const match of firstCell.matchAll(/`([a-z_]+\.[a-z_]+)`/g)) names.push(match[1]!);
  }
  return names;
}

describe('events', () => {
  it('covers every event in spec §10', () => {
    const names = specEventNames();
    expect(names.length).toBeGreaterThanOrEqual(16);
    expect([...EVENT_TYPES]).toEqual(expect.arrayContaining(names));
  });

  it('adds only order.placed (T-06) and approval.decided (architecture.md) beyond the spec', () => {
    const extra = EVENT_TYPES.filter((t) => !specEventNames().includes(t));
    expect(extra.sort()).toEqual(['approval.decided', 'order.placed']);
  });

  it('has no duplicates', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });

  it('recognises event types', () => {
    expect(isEventType('order.paid')).toBe(true);
    expect(isEventType('order.exploded')).toBe(false);
  });

  it('narrows the payload by type', () => {
    const event = {
      seq: 1,
      type: 'order.paid',
      entityType: 'order',
      entityId: 'ORD-1042',
      payload: {
        orderNumber: 'ORD-1042',
        totalPaise: 79900,
        itemCount: 1,
        gstType: 'intra',
        paidAt: '2026-11-07T10:00:00.000Z',
      },
      createdAt: '2026-11-07T10:00:00.000Z',
    } satisfies StoreEvent;
    expectTypeOf(event.payload.totalPaise).toBeNumber();
    expectTypeOf<StoreEvent<'refund.requested'>['payload']['approvalId']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<(typeof EVENT_TYPES)[number]>().toEqualTypeOf<EventType>();
  });
});
