'use client';

import Link from 'next/link';
import { itemCount } from '../lib/cart';
import { useCart } from './use-cart';

export function CartLink() {
  const [cart] = useCart();
  const count = itemCount(cart);
  return (
    <Link
      href="/cart"
      className="rounded-full border border-neutral-300 px-3 py-1 text-sm font-medium hover:bg-neutral-100"
      aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
    >
      Cart <span data-testid="cart-count">{count}</span>
    </Link>
  );
}
