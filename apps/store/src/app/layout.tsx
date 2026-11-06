import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DEMO_BANNER } from '@switch-gear/shared';
import { CartLink } from '../components/CartLink';
import { COLLECTIONS } from '../server/seed/catalogue';
import { POLICIES } from './policies/[slug]/policies';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Switch Gear', template: '%s · Switch Gear' },
  description: 'Printed tees from Bangalore. Demo store.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="flex min-h-screen flex-col bg-white text-neutral-900 antialiased">
        <div
          role="note"
          className="bg-amber-300 px-4 py-2 text-center text-sm font-medium"
          data-testid="demo-banner"
        >
          {DEMO_BANNER}
        </div>

        <header className="border-b border-neutral-200">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="text-lg font-extrabold tracking-tight">
              SWITCH GEAR
            </Link>
            <CartLink />
          </div>
          <nav aria-label="Collections" className="mx-auto max-w-5xl overflow-x-auto px-4 pb-3">
            <ul className="flex gap-4 text-sm whitespace-nowrap text-neutral-700">
              {Object.entries(COLLECTIONS).map(([slug, name]) => (
                <li key={slug}>
                  <Link href={`/collections/${slug}`} className="hover:underline">
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>

        <footer className="border-t border-neutral-200 text-sm text-neutral-600">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 sm:flex-row sm:justify-between">
            <p>Switch Gear, Bengaluru. A fictional brand.</p>
            <nav aria-label="Policies">
              <ul className="flex flex-wrap gap-4">
                {Object.entries(POLICIES).map(([slug, policy]) => (
                  <li key={slug}>
                    <Link href={`/policies/${slug}`} className="hover:underline">
                      {policy.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
