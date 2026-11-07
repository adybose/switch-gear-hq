import type { Metadata } from 'next';
import { connection } from 'next/server';
import Link from 'next/link';
import { getDb } from '../../server/db';
import { trackOrder } from '../../server/tracking';
import { trackQuery } from '../../server/validation/tickets';

export const metadata: Metadata = { title: 'Track your order', robots: { index: false } };

type Props = { searchParams: Promise<{ number?: string | string[]; email?: string | string[] }> };

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

const inputClass =
  'mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 focus:border-neutral-900 focus:outline-none';

const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default async function TrackPage({ searchParams }: Props) {
  await connection();
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const number = first(params.number) ?? '';
  const email = first(params.email) ?? '';
  const submitted = number !== '' || email !== '';

  const parsed = submitted ? trackQuery.safeParse({ number, email }) : null;
  const tracked = parsed?.success
    ? await trackOrder(getDb(), parsed.data.number, parsed.data.email)
    : null;

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-3xl font-bold">Track your order</h1>
      <form method="get" action="/track" className="space-y-3">
        <label className="block text-sm font-medium">
          Order number
          <input
            name="number"
            defaultValue={number}
            placeholder="ORD-1001"
            required
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Email used at checkout
          <input name="email" type="email" defaultValue={email} required className={inputClass} />
        </label>
        <button
          type="submit"
          className="cursor-pointer transition-colors enabled:hover:bg-neutral-700 rounded-md bg-neutral-900 px-4 py-2 font-medium text-white"
        >
          Track order
        </button>
      </form>

      {submitted && !tracked && (
        <p
          role="alert"
          data-testid="track-not-found"
          className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"
        >
          We couldn&apos;t find an order with that number and email. Check both and try again, or{' '}
          <Link href="/help" className="underline">
            contact us
          </Link>
          .
        </p>
      )}

      {tracked && (
        <section className="space-y-4" data-testid="track-result">
          <p className="text-neutral-700">
            Order <strong>{tracked.number}</strong>:{' '}
            <strong data-testid="track-status">
              {STATUS_TEXT[tracked.status] ?? tracked.status}
            </strong>
          </p>
          <ol
            className="space-y-2 border-l-2 border-neutral-200 pl-4 text-sm"
            data-testid="track-timeline"
          >
            {tracked.timeline.map((entry, i) => (
              <li key={`${entry.type}-${i}`}>
                <span className="font-medium">{entry.label}</span>
                <span className="block text-neutral-500">{IST.format(new Date(entry.at))} IST</span>
              </li>
            ))}
          </ol>
          {tracked.awb && (
            <p className="text-sm">
              Courier tracking number (AWB): <strong data-testid="track-awb">{tracked.awb}</strong>
            </p>
          )}
          {tracked.invoiceNumber && (
            <p className="text-sm">
              <Link
                href={`/invoices/${encodeURIComponent(tracked.invoiceNumber)}`}
                className="font-medium underline"
                data-testid="track-invoice"
              >
                GST invoice {tracked.invoiceNumber}
              </Link>
            </p>
          )}
          <p className="text-sm text-neutral-600">
            Need to return or exchange?{' '}
            <Link href={`/help?order=${encodeURIComponent(tracked.number)}`} className="underline">
              Tell us here
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}
