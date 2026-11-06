import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DEMO_BANNER } from '@switch-gear/shared';
import './globals.css';

export const metadata: Metadata = {
  title: 'Switch Gear',
  description: 'T-shirts from Bangalore. Demo store.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        <div className="bg-amber-300 px-4 py-2 text-center text-sm font-medium">{DEMO_BANNER}</div>
        {children}
      </body>
    </html>
  );
}
