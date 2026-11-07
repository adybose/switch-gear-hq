import type { Metadata } from 'next';
import { CheckoutForm } from '../../components/CheckoutForm';

export const metadata: Metadata = { title: 'Checkout' };

export default function CheckoutPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Checkout</h1>
      <CheckoutForm />
    </div>
  );
}
