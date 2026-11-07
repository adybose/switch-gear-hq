import type { Metadata } from 'next';
import { ContactForm } from '../../components/ContactForm';

export const metadata: Metadata = { title: 'Contact and returns' };

type Props = { searchParams: Promise<{ order?: string | string[] }> };

export default async function HelpPage({ searchParams }: Props) {
  const { order } = await searchParams;
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-3xl font-bold">Contact and returns</h1>
      <p className="text-neutral-700">
        Ask a question, or start a return or exchange. Include your order number if you have one.
      </p>
      <ContactForm orderNumber={typeof order === 'string' ? order : ''} />
    </div>
  );
}
