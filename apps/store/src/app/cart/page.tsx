import type { Metadata } from 'next';
import { CartView } from '../../components/CartView';

export const metadata: Metadata = { title: 'Cart' };

export default function CartPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold">Your cart</h1>
      <CartView />
    </div>
  );
}
