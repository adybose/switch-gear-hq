import { EVENT_TYPES } from '@switch-gear/shared';
import { describe, expect, it } from 'vitest';
import { CHANNELS, ROUTES, departmentRoute } from '../routes';

describe('routing table', () => {
  it('has an entry for every event type', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('only names real channels, and never routes to #events or #research', () => {
    for (const route of Object.values(ROUTES)) {
      if (!route) continue;
      for (const room of [route.room, ...route.also]) {
        expect(CHANNELS).toContain(room);
        expect(['events', 'research']).not.toContain(room);
      }
      expect(route.also).not.toContain(route.room);
    }
  });

  it('follows the owners in spec §10', () => {
    expect(ROUTES['order.paid']).toEqual({
      room: 'fulfilment',
      mention: 'fulfilment',
      also: ['finance'],
    });
    expect(ROUTES['refund.requested']).toMatchObject({ room: 'finance', mention: 'finance' });
    expect(ROUTES['ticket.created']).toMatchObject({ room: 'support', mention: 'support' });
    expect(ROUTES['campaign.result']).toMatchObject({ room: 'marketing', mention: 'marketing' });
    expect(ROUTES['checks.failed']).toMatchObject({ room: 'engineering', mention: 'builder' });
    expect(ROUTES['approval.requested']).toMatchObject({ room: 'approvals', mention: 'founder' });
    expect(ROUTES['report.daily']).toMatchObject({ room: 'hq', mention: 'chief-of-staff' });
    expect(ROUTES['order.placed']).toBeNull();
  });

  it('maps every department to its room and role', () => {
    expect(departmentRoute('finance')).toEqual({ room: 'finance', mention: 'finance' });
    expect(departmentRoute('engineering')).toEqual({ room: 'engineering', mention: 'builder' });
    expect(departmentRoute('hq')).toEqual({ room: 'hq', mention: 'chief-of-staff' });
    expect(departmentRoute('founder')).toEqual({ room: 'approvals', mention: 'founder' });
  });
});
