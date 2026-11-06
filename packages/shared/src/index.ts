// Shared types and helpers for every workspace. Money, GST, events and clock arrive in T-04.

/** Shown on every storefront page (spec: no real payments or deliveries). */
export const DEMO_BANNER = 'Demo store. No real payments or deliveries.';

/** Default local ports, matching docs/architecture.md. */
export const DEFAULT_PORTS = {
  store: 3000,
  sim: 4000,
  gatekeeper: 4100,
  db: 5432,
} as const;
