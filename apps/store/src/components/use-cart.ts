'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { parseCart, type Cart } from '../lib/cart';

const STORAGE_KEY = 'sg-cart-v1';
const CHANGE_EVENT = 'sg-cart-change';
const EMPTY: Cart = [];

let cachedRaw: string | null = null;
let cachedCart: Cart = EMPTY;

function getSnapshot(): Cart {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedCart = parseCart(raw);
  }
  return cachedCart;
}

function subscribe(onChange: () => void): () => void {
  // `storage` fires for other tabs; CHANGE_EVENT for this one.
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** The browser cart, shared across components and tabs. Empty during server rendering. */
export function useCart(): [Cart, (update: (cart: Cart) => Cart) => void] {
  const cart = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const update = useCallback((fn: (cart: Cart) => Cart) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fn(getSnapshot())));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [cart, update];
}
