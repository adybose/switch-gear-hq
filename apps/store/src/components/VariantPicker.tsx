'use client';

import { formatRupees } from '@switch-gear/shared/money';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { addLine } from '../lib/cart';
import { sizeChartFor } from '../lib/size-chart';
import {
  byOrder,
  COLOUR_ORDER,
  colourStyle,
  FIT_LABELS,
  FIT_ORDER,
  SIZE_ORDER,
} from '../lib/styles';
import type { ProductDetail } from '../server/catalogue';
import { useCart } from './use-cart';

type Variant = ProductDetail['variants'][number];

function unique(values: string[], order: string[]): string[] {
  return [...new Set(values)].sort(byOrder(order));
}

const optionClass = (selected: boolean) =>
  `cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${
    selected
      ? 'border-neutral-900 bg-neutral-900 text-white'
      : 'border-neutral-300 hover:border-neutral-500'
  }`;

export function VariantPicker({ product }: { product: ProductDetail }) {
  const { variants } = product;
  const fits = unique(
    variants.map((v) => v.fit),
    FIT_ORDER,
  );
  const colours = unique(
    variants.map((v) => v.colour),
    COLOUR_ORDER,
  );
  const first = variants[0]!;

  const [fit, setFit] = useState(first.fit);
  const [colour, setColour] = useState(first.colour);
  const [size, setSize] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [, updateCart] = useCart();

  const sizes = useMemo(
    () =>
      unique(
        variants.filter((v) => v.fit === fit && v.colour === colour).map((v) => v.size),
        SIZE_ORDER,
      ),
    [variants, fit, colour],
  );
  const selected: Variant | undefined = variants.find(
    (v) => v.fit === fit && v.colour === colour && v.size === size,
  );
  const price =
    selected?.pricePaise ?? variants.find((v) => v.fit === fit && v.colour === colour)?.pricePaise;

  function choose(update: () => void) {
    update();
    setAdded(false);
  }

  function addToCart() {
    if (!selected) return;
    updateCart((cart) =>
      addLine(cart, {
        sku: selected.sku,
        slug: product.slug,
        name: product.name,
        fit: selected.fit,
        colour: selected.colour,
        size: selected.size,
        unitPricePaise: selected.pricePaise,
      }),
    );
    setAdded(true);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Generated SVG mockup; nothing to optimise. */}
      <img
        src={`/artwork/${product.slug}.svg?colour=${colour}`}
        alt={`${product.name} tee in ${colourStyle(colour).label}`}
        width={400}
        height={440}
        className="aspect-[10/11] w-full rounded-lg bg-neutral-100"
      />

      <div className="space-y-5">
        <p className="text-2xl font-semibold" data-testid="price">
          {price !== undefined ? formatRupees(price) : '—'}
          <span className="ml-2 text-sm font-normal text-neutral-500">incl. GST</span>
        </p>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Fit</legend>
          <div className="flex flex-wrap gap-2">
            {fits.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={fit === f}
                className={optionClass(fit === f)}
                onClick={() => choose(() => setFit(f))}
              >
                {FIT_LABELS[f] ?? f}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            Colour: <span className="font-normal">{colourStyle(colour).label}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {colours.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={colour === c}
                aria-label={colourStyle(c).label}
                title={colourStyle(c).label}
                className={`h-9 w-9 cursor-pointer rounded-full border-2 transition-colors ${colour === c ? 'border-neutral-900 ring-2 ring-neutral-900 ring-offset-2' : 'border-neutral-300 hover:border-neutral-500'}`}
                style={{ backgroundColor: colourStyle(c).hex }}
                onClick={() => choose(() => setColour(c))}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Size</legend>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={size === s}
                className={optionClass(size === s)}
                onClick={() => choose(() => setSize(s))}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          disabled={!selected}
          onClick={addToCart}
          className="cursor-pointer transition-colors enabled:hover:bg-neutral-700 w-full rounded-md bg-neutral-900 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {selected ? 'Add to cart' : 'Choose a size'}
        </button>
        {added && (
          <p role="status" className="text-sm text-green-700">
            Added to cart.{' '}
            <Link href="/cart" className="underline">
              View cart
            </Link>
          </p>
        )}

        <details className="rounded-md border border-neutral-200 p-3" open>
          <summary className="cursor-pointer text-sm font-medium">
            Size chart: {FIT_LABELS[fit] ?? fit}
          </summary>
          <table className="mt-3 w-full text-left text-sm">
            <caption className="sr-only">Garment measurements in inches</caption>
            <thead>
              <tr className="text-neutral-500">
                <th className="py-1 font-medium">Size</th>
                <th className="py-1 font-medium">Chest (in)</th>
                <th className="py-1 font-medium">Length (in)</th>
              </tr>
            </thead>
            <tbody>
              {sizeChartFor(fit).map((row) => (
                <tr key={row.size} className="border-t border-neutral-100">
                  <td className="py-1">{row.size}</td>
                  <td className="py-1">{row.chestIn}</td>
                  <td className="py-1">{row.lengthIn}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-neutral-500">Measured flat across the chest, doubled.</p>
        </details>
      </div>
    </div>
  );
}
