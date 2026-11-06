import { describe, expect, it } from 'vitest';
import { allocate, priceOrder, type PricingLine } from './pricing';
import { checkPincode } from './shipping';

const classic = (qty = 1, sku = 'SG-SILKBOARD-CLS-BLK-M'): PricingLine => ({
  sku,
  unitPricePaise: 59900,
  qty,
});
const oversized = (qty = 1, sku = 'SG-OFFBYONE-OVR-NVY-L'): PricingLine => ({
  sku,
  unitPricePaise: 79900,
  qty,
});
const premium = (qty = 1): PricingLine => ({
  sku: 'SG-KAAPIBREAK-PRM-WHT-S',
  unitPricePaise: 99900,
  qty,
});

// The five sample carts from T-06. Totals are GST-inclusive.
describe('priceOrder: sample carts', () => {
  it('1. one classic tee in Karnataka: ₹79 shipping, CGST + SGST', () => {
    expect(priceOrder({ lines: [classic()], state: 'Karnataka' })).toMatchObject({
      itemCount: 1,
      subtotalPaise: 59900,
      discountSource: null,
      discountPaise: 0,
      shippingPaise: 7900,
      totalPaise: 67800,
      gstType: 'intra',
      taxablePaise: 64571,
      taxPaise: 3229,
      cgstPaise: 1614,
      sgstPaise: 1615,
      igstPaise: 0,
    });
  });

  it('2. two tees over ₹999 to Delhi: free shipping, IGST', () => {
    expect(priceOrder({ lines: [classic(), oversized()], state: 'Delhi' })).toMatchObject({
      subtotalPaise: 139800,
      discountPaise: 0,
      shippingPaise: 0,
      totalPaise: 139800,
      gstType: 'inter',
      taxablePaise: 133143,
      igstPaise: 6657,
      taxPaise: 6657,
    });
  });

  it('3. any three tees get 10% off', () => {
    expect(priceOrder({ lines: [classic(3)], state: 'Karnataka' })).toMatchObject({
      itemCount: 3,
      subtotalPaise: 179700,
      discountSource: 'bundle',
      discountPercent: 10,
      discountPaise: 17970,
      shippingPaise: 0,
      totalPaise: 161730,
      taxablePaise: 154029,
      cgstPaise: 3850,
      sgstPaise: 3851,
    });
  });

  it('4. a discount code can take the order back under free shipping', () => {
    expect(priceOrder({ lines: [premium()], codePercent: 15, state: 'Maharashtra' })).toMatchObject(
      {
        subtotalPaise: 99900,
        discountSource: 'code',
        discountPaise: 14985,
        shippingPaise: 7900, // ₹849.15 of goods after the discount is under ₹999
        totalPaise: 92815,
        taxablePaise: 88395,
        igstPaise: 4420,
      },
    );
  });

  it('5. a bigger code beats the bundle; they do not stack', () => {
    expect(
      priceOrder({ lines: [oversized(3)], codePercent: 20, state: 'Tamil Nadu' }),
    ).toMatchObject({
      subtotalPaise: 239700,
      discountSource: 'code',
      discountPercent: 20,
      discountPaise: 47940,
      shippingPaise: 0,
      totalPaise: 191760,
      taxablePaise: 182629,
      igstPaise: 9131,
    });
  });
});

describe('priceOrder: rules', () => {
  it('keeps the bundle when the code is smaller', () => {
    const p = priceOrder({ lines: [classic(2), oversized(1)], codePercent: 5, state: 'Goa' });
    expect([p.discountSource, p.discountPercent]).toEqual(['bundle', 10]);
  });

  it('spreads the discount over lines and the parts add up', () => {
    const p = priceOrder({ lines: [classic(1), oversized(1), premium(1)], state: 'Kerala' });
    expect(p.lines.reduce((s, l) => s + l.discountPaise, 0)).toBe(p.discountPaise);
    expect(p.taxablePaise + p.taxPaise).toBe(p.totalPaise);
    expect(p.lines.every((l) => l.gstRate === 5)).toBe(true);
  });

  it('charges 18% GST on a piece over ₹2,500 before GST, shipping at the higher rate', () => {
    const p = priceOrder({
      lines: [{ sku: 'X', unitPricePaise: 300000, qty: 1 }, classic()],
      state: 'Delhi',
    });
    expect(p.lines.map((l) => l.gstRate)).toEqual([18, 5]);
    expect(p.taxablePaise + p.taxPaise).toBe(p.totalPaise);
  });

  it('rejects bad input', () => {
    expect(() => priceOrder({ lines: [], state: 'Goa' })).toThrow(RangeError);
    expect(() => priceOrder({ lines: [classic(0)], state: 'Goa' })).toThrow(RangeError);
    expect(() => priceOrder({ lines: [classic()], codePercent: 0, state: 'Goa' })).toThrow(
      RangeError,
    );
  });
});

describe('allocate', () => {
  it('splits in proportion and always sums exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(17970, [59900, 59900, 59900])).toEqual([5990, 5990, 5990]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
  });
});

describe('checkPincode', () => {
  it('sets the zone from the PIN', () => {
    expect(checkPincode('560001')).toEqual({
      serviceable: true,
      zone: 'same_city',
      transitDays: 1,
    });
    expect(checkPincode('600001')).toMatchObject({ zone: 'same_zone', transitDays: 3 });
    expect(checkPincode('110001')).toMatchObject({ zone: 'national', transitDays: 5 });
  });

  it('blocks areas ShipFast does not serve, with a clear message', () => {
    expect(checkPincode('744101')).toEqual({
      serviceable: false,
      reason: 'not_serviceable',
      message:
        "Sorry, our courier doesn't deliver to PIN 744101 (Andaman and Nicobar Islands) yet.",
    });
    expect(checkPincode('682555')).toMatchObject({ serviceable: false, reason: 'not_serviceable' });
    expect(checkPincode('194101')).toMatchObject({ serviceable: false });
    expect(checkPincode('900001')).toMatchObject({ serviceable: false });
  });

  it('rejects malformed PINs', () => {
    for (const pin of ['012345', '56001', 'abcdef', '5600011']) {
      expect(checkPincode(pin)).toMatchObject({ serviceable: false, reason: 'invalid_pincode' });
    }
  });
});
