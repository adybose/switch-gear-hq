import Link from 'next/link';
import { connection } from 'next/server';
import { ProductCard } from '../components/ProductCard';
import { listCollections, listProducts } from '../server/catalogue';
import { getDb } from '../server/db';

export default async function HomePage() {
  await connection(); // catalogue is read per request, never at build time
  const db = getDb();
  const [collections, products] = await Promise.all([listCollections(db), listProducts(db)]);

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          Tees from Bengaluru, printed when you order.
        </h1>
        <p className="max-w-xl text-neutral-600">
          Twelve designs about traffic, code and coffee. Classic, oversized and premium fits in five
          colours. Free shipping on orders of ₹999 or more.
        </p>
      </section>

      <section aria-labelledby="collections-heading" className="space-y-4">
        <h2 id="collections-heading" className="text-xl font-bold">
          Collections
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {collections.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/collections/${c.slug}`}
                className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400"
              >
                <span className="font-semibold">{c.name}</span>
                <span className="block text-sm text-neutral-500">
                  {c.productCount} {c.productCount === 1 ? 'design' : 'designs'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="all-heading" className="space-y-4">
        <h2 id="all-heading" className="text-xl font-bold">
          All designs
        </h2>
        {products.length === 0 ? (
          <p className="text-neutral-600">
            No designs yet. Run `npm run demo:reset` to seed the catalogue.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <li key={p.slug}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
