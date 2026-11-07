// ShipFast service area (docs/spec.md §5), shared by the store's checkout and the sim.
// The warehouse is in Bengaluru (PIN 560xxx). Zones set transit time and courier cost.

export type ShippingZone = 'same_city' | 'same_zone' | 'national';

export const ORIGIN_PIN_PREFIX = '560';

/** Areas ShipFast doesn't deliver to yet, by PIN prefix. */
export const UNSERVICEABLE_PIN_PREFIXES: { prefix: string; area: string }[] = [
  { prefix: '9', area: 'Army Postal Service addresses' },
  { prefix: '744', area: 'Andaman and Nicobar Islands' },
  { prefix: '68255', area: 'Lakshadweep' },
  { prefix: '194', area: 'Ladakh' },
];

export const PIN_PATTERN = /^[1-9][0-9]{5}$/;

export type Serviceability =
  | { serviceable: true; zone: ShippingZone; transitDays: number }
  | { serviceable: false; reason: 'invalid_pincode' | 'not_serviceable'; message: string };

const TRANSIT_DAYS: Record<ShippingZone, number> = { same_city: 1, same_zone: 3, national: 5 };

/**
 * Same city: Bengaluru (560). Same zone: south India, PINs starting 5 or 6.
 * National: everything else ShipFast serves.
 */
export function checkPincode(pincode: string): Serviceability {
  const pin = pincode.trim();
  if (!PIN_PATTERN.test(pin)) {
    return {
      serviceable: false,
      reason: 'invalid_pincode',
      message: 'Enter a 6-digit PIN code that does not start with 0.',
    };
  }
  const blocked = UNSERVICEABLE_PIN_PREFIXES.find((b) => pin.startsWith(b.prefix));
  if (blocked) {
    return {
      serviceable: false,
      reason: 'not_serviceable',
      message: `Sorry, our courier doesn't deliver to PIN ${pin} (${blocked.area}) yet.`,
    };
  }
  const zone: ShippingZone = pin.startsWith(ORIGIN_PIN_PREFIX)
    ? 'same_city'
    : pin.startsWith('5') || pin.startsWith('6')
      ? 'same_zone'
      : 'national';
  return { serviceable: true, zone, transitDays: TRANSIT_DAYS[zone] };
}
