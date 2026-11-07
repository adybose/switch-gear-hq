'use client';

import { formatRupees } from '@switch-gear/shared/money';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { itemCount, type Cart } from '../lib/cart';
import { INDIAN_STATES } from '../lib/states';
import { colourStyle, FIT_LABELS } from '../lib/styles';
import { useCart } from './use-cart';

interface Quote {
  subtotalPaise: number;
  discountSource: 'bundle' | 'code' | null;
  discountPercent: number;
  discountPaise: number;
  shippingPaise: number;
  taxPaise: number;
  totalPaise: number;
  discountCode: string | null;
  discountCodeError: string | null;
  pincode: { serviceable: boolean; message?: string; transitDays?: number } | null;
}

type ApiError = { error: string; details?: Record<string, string> };

const FIELDS = [
  { name: 'name', label: 'Full name', autoComplete: 'name', type: 'text' },
  { name: 'email', label: 'Email', autoComplete: 'email', type: 'email' },
  { name: 'phone', label: 'Phone', autoComplete: 'tel', type: 'tel' },
  { name: 'address', label: 'Address', autoComplete: 'street-address', type: 'text' },
  { name: 'city', label: 'City', autoComplete: 'address-level2', type: 'text' },
] as const;

const inputClass =
  'mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 focus:border-neutral-900 focus:outline-none';

function itemsOf(cart: Cart) {
  return cart.map((l) => ({ sku: l.sku, qty: l.qty }));
}

export function CheckoutForm() {
  const [cart, updateCart] = useCart();
  const [state, setState] = useState('Karnataka');
  const [pincode, setPincode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const cartKey = JSON.stringify(itemsOf(cart));
  const pinToCheck = /^\d{6}$/.test(pincode) ? pincode : undefined;

  useEffect(() => {
    const items = JSON.parse(cartKey) as { sku: string; qty: number }[];
    if (items.length === 0) return;
    const controller = new AbortController();
    fetch('/api/v1/checkout/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, state, pincode: pinToCheck, discountCode: code || undefined }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) {
          setQuote((await res.json()) as Quote);
        } else {
          const body = (await res.json()) as ApiError;
          setErrors((e) => ({ ...e, ...body.details }));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [cartKey, state, pinToCheck, code]);

  // An error from the last submit goes away as soon as that field is edited.
  function clearFieldError(event: FormEvent<HTMLFormElement>) {
    const name = (event.target as HTMLInputElement).name;
    if (!name) return;
    setErrors((current) => {
      const key = `customer.${name}`;
      if (!(key in current) && !current['(body)']) return current;
      const rest = { ...current };
      delete rest[key];
      delete rest['(body)'];
      return rest;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customer = Object.fromEntries(
      ['name', 'email', 'phone', 'address', 'city', 'state', 'pincode'].map((k) => [
        k,
        String(form.get(k) ?? ''),
      ]),
    );
    setSubmitting(true);
    setErrors({});
    try {
      const res = await fetch('/api/v1/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: itemsOf(cart), customer, discountCode: code || undefined }),
      });
      if (res.status === 201) {
        const { paymentUrl } = (await res.json()) as { paymentUrl: string };
        updateCart(() => []);
        window.location.assign(paymentUrl);
        return;
      }
      const body = (await res.json().catch(() => ({ error: 'unknown' }))) as ApiError;
      setErrors(body.details ?? { '(body)': 'Something went wrong. Please try again.' });
    } catch {
      setErrors({ '(body)': 'Could not reach the store. Please try again.' });
    }
    setSubmitting(false);
  }

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

  const pinMessage =
    errors['customer.pincode'] ??
    (quote?.pincode && !quote.pincode.serviceable ? quote.pincode.message : undefined);
  const generalError = errors['(body)'] ?? errors.items;

  return (
    <form
      onSubmit={submit}
      onChange={clearFieldError}
      className="grid gap-8 md:grid-cols-[1fr_20rem]"
      noValidate
    >
      <fieldset className="space-y-4">
        <legend className="mb-2 text-lg font-semibold">Delivery details</legend>
        {FIELDS.map((f) => (
          <label key={f.name} className="block text-sm font-medium">
            {f.label}
            <input
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              required
              className={inputClass}
              aria-invalid={Boolean(errors[`customer.${f.name}`])}
            />
            {errors[`customer.${f.name}`] && (
              <span className="mt-1 block text-sm text-red-700">
                {errors[`customer.${f.name}`]}
              </span>
            )}
          </label>
        ))}
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm font-medium">
            State
            <select
              name="state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={inputClass}
            >
              {INDIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            PIN code
            <input
              name="pincode"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              required
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
              className={inputClass}
              aria-invalid={Boolean(pinMessage)}
            />
          </label>
        </div>
        {pinMessage && (
          <p role="alert" className="text-sm text-red-700" data-testid="pincode-error">
            {pinMessage}
          </p>
        )}
        {quote?.pincode?.serviceable && (
          <p className="text-sm text-neutral-600">
            Delivers in about {quote.pincode.transitDays} days after printing.
          </p>
        )}
        <p className="text-xs text-neutral-500">
          Demo store: use made-up details. No real payment is taken.
        </p>
      </fieldset>

      <aside className="space-y-4 rounded-lg bg-neutral-50 p-4">
        <h2 className="text-lg font-semibold">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {cart.map((l) => (
            <li key={l.sku} className="flex justify-between gap-2">
              <span>
                {l.qty} × {l.name}
                <span className="block text-neutral-500">
                  {FIT_LABELS[l.fit] ?? l.fit} · {colourStyle(l.colour).label} · {l.size}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <label className="sr-only" htmlFor="discount-code">
            Discount code
          </label>
          <input
            id="discount-code"
            placeholder="Discount code"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => {
              setErrors((e) => ({ ...e, discountCode: '' }));
              setCode(codeInput.trim());
            }}
            className="cursor-pointer rounded-md border border-neutral-900 px-3 py-2 text-sm font-medium transition-colors enabled:hover:bg-neutral-100"
          >
            Apply
          </button>
        </div>
        {(errors.discountCode || quote?.discountCodeError) && (
          <p role="alert" className="text-sm text-red-700">
            {errors.discountCode || quote?.discountCodeError}
          </p>
        )}
        {code && quote && !quote.discountCodeError && quote.discountSource === 'bundle' && (
          <p className="text-sm text-neutral-600">
            Your 3-tee discount is bigger, so we kept that one.
          </p>
        )}

        {quote ? (
          <dl className="space-y-1 text-sm" data-testid="totals">
            <div className="flex justify-between">
              <dt>Subtotal ({itemCount(cart)} items)</dt>
              <dd>{formatRupees(quote.subtotalPaise)}</dd>
            </div>
            {quote.discountPaise > 0 && (
              <div className="flex justify-between text-green-700">
                <dt>
                  {quote.discountSource === 'code'
                    ? `Code ${quote.discountCode} (${quote.discountPercent}%)`
                    : `3 or more tees (${quote.discountPercent}%)`}
                </dt>
                <dd>−{formatRupees(quote.discountPaise)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Shipping</dt>
              <dd>{quote.shippingPaise === 0 ? 'Free' : formatRupees(quote.shippingPaise)}</dd>
            </div>
            <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd data-testid="total">{formatRupees(quote.totalPaise)}</dd>
            </div>
            <p className="text-xs text-neutral-500">Includes {formatRupees(quote.taxPaise)} GST.</p>
          </dl>
        ) : (
          <p className="text-sm text-neutral-500">Working out totals…</p>
        )}

        {generalError && (
          <p role="alert" className="text-sm text-red-700">
            {generalError}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || !quote}
          className="cursor-pointer transition-colors enabled:hover:bg-neutral-700 w-full rounded-md bg-neutral-900 px-4 py-3 font-semibold text-white disabled:bg-neutral-300"
        >
          {submitting ? 'Placing order…' : 'Place order'}
        </button>
      </aside>
    </form>
  );
}
