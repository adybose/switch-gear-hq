import { describe, expect, it } from 'vitest';
import { COLLECTIONS, DESIGNS, variantsFor } from './catalogue';

describe('seed catalogue (spec §2)', () => {
  it('has 12 designs in 4 collections: 3, 4, 3, 2', () => {
    expect(DESIGNS).toHaveLength(12);
    const perCollection = Object.fromEntries(
      Object.keys(COLLECTIONS).map((c) => [c, DESIGNS.filter((d) => d.collection === c).length]),
    );
    expect(perCollection).toEqual({
      'namma-bengaluru': 3,
      'dev-humour': 4,
      'kaapi-culture': 3,
      basics: 2,
    });
  });

  it('has unique slugs and SKU codes', () => {
    expect(new Set(DESIGNS.map((d) => d.slug)).size).toBe(12);
    expect(new Set(DESIGNS.map((d) => d.code)).size).toBe(12);
  });

  it('includes the spec examples', () => {
    const names = DESIGNS.map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Silk Board Survivor',
        'It works on my machine',
        'Powered by filter coffee',
      ]),
    );
  });

  it('builds 3 fits x 5 colours x 6 sizes per design with unique SKUs', () => {
    const all = DESIGNS.flatMap(variantsFor);
    expect(all).toHaveLength(12 * 90);
    expect(new Set(all.map((v) => v.sku)).size).toBe(all.length);
  });

  it('uses the spec SKU format and prices in paise', () => {
    const silkBoard = variantsFor(DESIGNS.find((d) => d.code === 'SILKBOARD')!);
    const example = silkBoard.find((v) => v.sku === 'SG-SILKBOARD-OVR-BLK-L');
    expect(example).toEqual({
      sku: 'SG-SILKBOARD-OVR-BLK-L',
      fit: 'oversized',
      colour: 'black',
      size: 'L',
      pricePaise: 79900,
    });
    const priceByFit = Object.fromEntries(silkBoard.map((v) => [v.fit, v.pricePaise]));
    expect(priceByFit).toEqual({ classic: 59900, oversized: 79900, premium: 99900 });
    for (const v of silkBoard)
      expect(v.sku).toMatch(/^SG-[A-Z0-9]+-(CLS|OVR|PRM)-[A-Z]{3}-X{0,2}[SML]$/);
  });
});
