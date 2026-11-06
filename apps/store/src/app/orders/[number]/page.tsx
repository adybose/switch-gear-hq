import { formatRupees } from '@switch-gear/shared/money';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { colourStyle, FIT_LABELS } from '../../../lib/styles';
import { getOrderSummary } from '../../../server/checkout';
import { getDb } from '../../../server/db';
import { verifyOrderToken } from '../../../server/order-link';

export const metadata: Metadata = { title: 'Order confirmation', robots: { index: false } };

type Props = {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
};

const STATUS_TEXT: Record<string, string> = {
  placed: 'Waiting for payment',
  paid: 'Paid, going to print',
  printing: 'Printing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  refunded: 'Refunded',
};

export default async function OrderConfirmationPage({ params, searchParams }: Props) {
  await connection();
  const { number } = await params;
  const { t } = await searchParams;
  // A wrong or missing token looks exactly like a missing order.
  if (!verifyOrderToken(number, typeof t === 'string' ? t : null)) notFound();
  const order = await getOrderSummary(getDb(), number);
  if (!order) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-neutral-500">Thanks, {order.customer.name}.</p>
        <h1 className="text-3xl font-bold">
          Order <span data-testid="order-number">{order.number}</span>
        </h1>
        <p className="text-neutral-700">
          Status: <strong>{STATUS_TEXT[order.status] ?? order.status}</strong>
        </p>
      </div>

      {order.status === 'placed' && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Payment through our demo gateway opens soon. Nothing has been charged.
        </p>
      )}

      <ul className="divide-y divide-neutral-200">
        {order.items.map((item) => (
          <li key={item.variant.sku} className="flex justify-between gap-4 py-3 text-sm">
            <span>
              {item.qty} × {item.variant.product.name}
              <span className="block text-neutral-500">
                {FIT_LABELS[item.variant.fit] ?? item.variant.fit} ·{' '}
                {colourStyle(item.variant.colour).label} · {item.variant.size}
              </span>
            </span>
            <span>{formatRupees(item.unitPricePaise * item.qty)}</span>
          </li>
        ))}
      </ul>

      <dl className="space-y-1 rounded-lg bg-neutral-50 p-4 text-sm" data-testid="order-totals">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd>{formatRupees(order.subtotalPaise)}</dd>
        </div>
        {order.discountPaise > 0 && (
          <div className="flex justify-between text-green-700">
            <dt>Discount{order.discountCode ? ` (${order.discountCode})` : ''}</dt>
            <dd>−{formatRupees(order.discountPaise)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt>Shipping</dt>
          <dd>{order.shippingPaise === 0 ? 'Free' : formatRupees(order.shippingPaise)}</dd>
        </div>
        <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd data-testid="order-total">{formatRupees(order.totalPaise)}</dd>
        </div>
        <p className="text-xs text-neutral-500">Includes {formatRupees(order.taxPaise)} GST.</p>
      </dl>

      <p className="text-sm text-neutral-600">
        Shipping to {order.customer.city}, {order.customer.state} {order.customer.pincode}. Keep
        your order number to track it.
      </p>
      <Link href="/" className="inline-block font-medium underline">
        Keep shopping
      </Link>
    </div>
  );
}
