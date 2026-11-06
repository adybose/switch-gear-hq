import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';
import { VariantPicker } from '../../../components/VariantPicker';
import { getProduct } from '../../../server/catalogue';
import { getDb } from '../../../server/db';

type Props = { params: Promise<{ slug: string }> };

// One query per request, shared by the metadata and the page.
const loadProduct = cache((slug: string) => getProduct(getDb(), slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  const product = await loadProduct(slug);
  return { title: product?.name ?? 'Not found', description: product?.description };
}

export default async function ProductPage({ params }: Props) {
  await connection();
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) notFound();

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
        <Link href="/" className="hover:underline">
          Home
        </Link>{' '}
        /{' '}
        <Link href={`/collections/${product.collection}`} className="hover:underline">
          {product.collectionName}
        </Link>
      </nav>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{product.name}</h1>
        <p className="text-neutral-600">{product.description}</p>
      </div>
      <VariantPicker product={product} />
    </div>
  );
}
