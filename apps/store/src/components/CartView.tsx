'use client';

import { formatRupees } from '@switch-gear/shared/money';
import Link from 'next/link';
import { MAX_QTY_PER_LINE, removeLine, setQty, subtotalPaise } from '../lib/cart';
import { colourStyle, FIT_LABELS } from '../lib/styles';
import { useCart } from './use-cart';

export function CartView() {
  const [cart, updateCart] = useCart();

  if (cart.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center">
        <p className="text-neutral-600">Your cart is empty.</p>
        <Link href="/" className="mt-3 inline-block font-medium underline">
          Browse tees
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-neutral-200">
        {cart.map((line) => (
          <li key={line.sku} className="flex gap-4 py-4" data-testid="cart-line">
            <img
              src={`/artwork/${line.slug}.svg?colour=${line.colour}`}
              alt=""
              width={80}
              height={88}
              className="h-22 w-20 shrink-0 rounded bg-neutral-100"
            />
            <div className="min-w-0 flex-1">
              <Link href={`/products/${line.slug}`} className="font-semibold hover:underline">
                {line.name}
              </Link>
              <p className="text-sm text-neutral-600">
                {FIT_LABELS[line.fit] ?? line.fit} · {colourStyle(line.colour).label} · {line.size}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Remove one ${line.name}`}
                  className="h-8 w-8 cursor-pointer rounded border border-neutral-300 transition-colors enabled:hover:bg-neutral-100"
                  onClick={() => updateCart((c) => setQty(c, line.sku, line.qty - 1))}
                >
                  −
                </button>
                <span aria-label="Quantity" className="w-6 text-center">
                  {line.qty}
                </span>
                <button
                  type="button"
                  aria-label={`Add one ${line.name}`}
                  disabled={line.qty >= MAX_QTY_PER_LINE}
                  className="h-8 w-8 cursor-pointer rounded border border-neutral-300 transition-colors enabled:hover:bg-neutral-100 disabled:opacity-40"
                  onClick={() => updateCart((c) => setQty(c, line.sku, line.qty + 1))}
                >
                  +
                </button>
                <button
                  type="button"
                  className="ml-3 cursor-pointer text-sm text-neutral-500 underline transition-colors hover:text-neutral-900"
                  onClick={() => updateCart((c) => removeLine(c, line.sku))}
                >
                  Remove
                </button>
              </div>
            </div>
            <p className="font-medium">{formatRupees(line.unitPricePaise * line.qty)}</p>
          </li>
        ))}
      </ul>

      <div className="space-y-2 rounded-lg bg-neutral-50 p-4">
        <p className="flex justify-between font-semibold">
          <span>Subtotal</span>
          <span data-testid="subtotal">{formatRupees(subtotalPaise(cart))}</span>
        </p>
        <p className="text-sm text-neutral-600">
          Prices include GST. Any 3 tees get 10% off, and shipping is free on orders of ₹999 or more
          (otherwise ₹79). Both are applied at checkout.
        </p>
        <Link
          href="/checkout"
          className="block w-full rounded-md bg-neutral-900 px-4 py-3 text-center font-semibold text-white"
        >
          Checkout
        </Link>
      </div>
    </div>
  );
}
