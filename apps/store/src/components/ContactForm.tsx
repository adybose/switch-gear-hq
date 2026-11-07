'use client';

import { useState, type FormEvent } from 'react';

const TYPES = [
  { value: 'wismo', label: 'Where is my order?' },
  { value: 'exchange', label: 'Exchange (size or colour)' },
  { value: 'return', label: 'Return' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'other', label: 'Something else' },
] as const;

const inputClass =
  'mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 focus:border-neutral-900 focus:outline-none';

export function ContactForm({ orderNumber = '' }: { orderNumber?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          orderNumber: form.get('orderNumber'),
          type: form.get('type'),
          message: form.get('message'),
        }),
      });
      if (res.status === 201)
        setTicketNumber(((await res.json()) as { ticketNumber: string }).ticketNumber);
      else
        setError(
          'Please check the form: use a valid email and write a message of up to 2000 characters.',
        );
    } catch {
      setError('Could not send just now. Please try again in a minute.');
    } finally {
      setSubmitting(false);
    }
  }

  if (ticketNumber) {
    return (
      <p className="rounded-md bg-green-50 p-3 text-green-900" data-testid="ticket-created">
        Thanks, we have your message. Your reference is <strong>{ticketNumber}</strong>. We reply by
        email.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm font-medium">
        Email
        <input name="email" type="email" required className={inputClass} />
      </label>
      <label className="block text-sm font-medium">
        Order number (optional)
        <input
          name="orderNumber"
          defaultValue={orderNumber}
          placeholder="ORD-1001"
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium">
        What is this about?
        <select name="type" defaultValue={orderNumber ? 'return' : 'other'} className={inputClass}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Message
        <textarea name="message" required maxLength={2000} rows={5} className={inputClass} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
