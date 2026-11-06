import { describe, expect, it } from 'vitest';
import {
  addLine,
  itemCount,
  MAX_QTY_PER_LINE,
  parseCart,
  removeLine,
  setQty,
  subtotalPaise,
  type CartLine,
} from './cart';
import { escapeXml, teeSvg, wrapText } from './mockup';
import { sizeChartFor } from './size-chart';
import { byOrder, COLOUR_ORDER } from './styles';

const line: Omit<CartLine, 'qty'> = {
  sku: 'SG-SILKBOARD-OVR-BLK-L',
  slug: 'silk-board-survivor',
  name: 'Silk Board Survivor',
  fit: 'oversized',
  colour: 'black',
  size: 'L',
  unitPricePaise: 79900,
};

describe('mockup SVG', () => {
  it('draws the design text on a tee in the chosen colour', () => {
    const svg = teeSvg({ text: 'Silk Board Survivor', colour: 'navy', style: 'statement' });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('fill="#1f2a44"');
    expect(svg).toContain('>SILK BOARD<');
    expect(svg).toContain('>SURVIVOR<');
    expect(svg).not.toMatch(/<image|href=/);
  });

  it('uses dark ink on light tees and light ink on dark tees', () => {
    expect(teeSvg({ text: 'X', colour: 'white', style: 'statement' })).toContain(
      'fill="#1c1c1c">X<',
    );
    expect(teeSvg({ text: 'X', colour: 'black', style: 'statement' })).toContain(
      'fill="#f5f5f4">X<',
    );
  });

  it('prints only a small logo for basics', () => {
    const svg = teeSvg({ text: 'Switch Gear Logo Tee', colour: 'olive', style: 'small-logo' });
    expect(svg).toContain('font-size="14"');
    expect(svg).toContain('SWITCH GEAR');
    expect(svg).not.toContain('LOGO TEE');
  });

  it('escapes text so a design name cannot inject markup', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
    const svg = teeSvg({ text: '<script>alert(1)</script>', colour: 'black', style: 'statement' });
    expect(svg).not.toContain('<script>');
  });

  it('falls back to black for an unknown colour', () => {
    expect(teeSvg({ text: 'X', colour: 'plaid', style: 'statement' })).toContain('fill="#1c1c1c"');
  });

  it('wraps text into at most four lines', () => {
    expect(wrapText('It works on my machine')).toEqual(['It works on my', 'machine']);
    expect(wrapText('a b c d e f g h i j k l m n o p q r s t', 3)).toHaveLength(4);
  });
});

describe('size chart', () => {
  it('has all six sizes, oversized cut wider', () => {
    expect(sizeChartFor('classic').map((r) => r.size)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(sizeChartFor('oversized')[2]!.chestIn).toBeGreaterThan(
      sizeChartFor('classic')[2]!.chestIn,
    );
    expect(sizeChartFor('unknown')).toEqual(sizeChartFor('classic'));
  });
});

describe('cart', () => {
  it('adds lines and merges the same SKU', () => {
    let cart = addLine([], line);
    cart = addLine(cart, line, 2);
    expect(cart).toEqual([{ ...line, qty: 3 }]);
    expect(itemCount(cart)).toBe(3);
    expect(subtotalPaise(cart)).toBe(239700);
  });

  it('caps quantity and removes a line at zero', () => {
    const cart = setQty(addLine([], line), line.sku, 99);
    expect(cart[0]!.qty).toBe(MAX_QTY_PER_LINE);
    expect(setQty(cart, line.sku, 0)).toEqual([]);
    expect(removeLine(cart, line.sku)).toEqual([]);
  });

  it('drops malformed stored data', () => {
    expect(parseCart(null)).toEqual([]);
    expect(parseCart('not json')).toEqual([]);
    expect(parseCart('{"sku":"x"}')).toEqual([]);
    const good = { ...line, qty: 1 };
    const stored = JSON.stringify([
      good,
      { ...good, sku: 'B', unitPricePaise: 1.5 },
      { ...good, qty: -1 },
    ]);
    expect(parseCart(stored)).toEqual([good]);
  });
});

describe('ordering', () => {
  it('sorts by the given order, unknowns last', () => {
    expect(['olive', 'zebra', 'black', 'navy'].sort(byOrder(COLOUR_ORDER))).toEqual([
      'black',
      'navy',
      'olive',
      'zebra',
    ]);
  });
});
