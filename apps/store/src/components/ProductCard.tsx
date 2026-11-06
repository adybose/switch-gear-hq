import { formatRupees } from '@switch-gear/shared/money';
import Link from 'next/link';
import type { ProductSummary } from '../server/catalogue';

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <img
        src={`/artwork/${product.slug}.svg`}
        alt={`${product.name} tee mockup`}
        width={400}
        height={440}
        className="aspect-[10/11] w-full rounded-lg bg-neutral-100 transition group-hover:opacity-90"
      />
      <h3 className="mt-2 text-sm font-semibold">{product.name}</h3>
      <p className="text-sm text-neutral-600">From {formatRupees(product.fromPricePaise)}</p>
    </Link>
  );
}
