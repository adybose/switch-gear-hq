import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ProductCard } from '../../../components/ProductCard';
import { collectionName, listProducts } from '../../../server/catalogue';
import { getDb } from '../../../server/db';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: collectionName(slug) };
}

export default async function CollectionPage({ params }: Props) {
  await connection();
  const { slug } = await params;
  const products = await listProducts(getDb(), slug);
  if (products.length === 0) notFound();

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
        <Link href="/" className="hover:underline">
          Home
        </Link>{' '}
        / {collectionName(slug)}
      </nav>
      <h1 className="text-3xl font-bold">{collectionName(slug)}</h1>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <li key={p.slug}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}
