import type { PrismaClient } from '../generated/prisma/client';
import { byOrder, COLOUR_ORDER, FIT_ORDER, SIZE_ORDER } from '../lib/styles';
import { COLLECTIONS } from './seed/catalogue';

// Storefront reads. Only published products and active variants are ever shown.

export interface CollectionSummary {
  slug: string;
  name: string;
  productCount: number;
}

export interface ProductSummary {
  slug: string;
  name: string;
  collection: string;
  /** Cheapest active variant. */
  fromPricePaise: number;
}

export interface ProductDetail {
  slug: string;
  name: string;
  collection: string;
  collectionName: string;
  description: string;
  variants: {
    sku: string;
    fit: string;
    colour: string;
    size: string;
    pricePaise: number;
  }[];
}

export function collectionName(slug: string): string {
  return COLLECTIONS[slug as keyof typeof COLLECTIONS] ?? slug;
}

const COLLECTION_ORDER = Object.keys(COLLECTIONS);

export async function listCollections(db: PrismaClient): Promise<CollectionSummary[]> {
  const groups = await db.product.groupBy({
    by: ['collection'],
    where: { status: 'published', variants: { some: { active: true } } },
    _count: true,
  });
  return groups
    .map((g) => ({
      slug: g.collection,
      name: collectionName(g.collection),
      productCount: g._count,
    }))
    .sort((a, b) => byOrder(COLLECTION_ORDER)(a.slug, b.slug));
}

export async function listProducts(
  db: PrismaClient,
  collection?: string,
): Promise<ProductSummary[]> {
  const products = await db.product.findMany({
    where: {
      status: 'published',
      ...(collection ? { collection } : {}),
      variants: { some: { active: true } },
    },
    orderBy: { name: 'asc' },
    select: {
      slug: true,
      name: true,
      collection: true,
      variants: {
        where: { active: true },
        orderBy: { pricePaise: 'asc' },
        take: 1,
        select: { pricePaise: true },
      },
    },
  });
  return products
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      collection: p.collection,
      fromPricePaise: p.variants[0]!.pricePaise,
    }))
    .sort(
      (a, b) =>
        byOrder(COLLECTION_ORDER)(a.collection, b.collection) || a.name.localeCompare(b.name),
    );
}

export async function getProduct(db: PrismaClient, slug: string): Promise<ProductDetail | null> {
  const product = await db.product.findFirst({
    where: { slug, status: 'published' },
    select: {
      slug: true,
      name: true,
      collection: true,
      description: true,
      variants: {
        where: { active: true },
        select: { sku: true, fit: true, colour: true, size: true, pricePaise: true },
      },
    },
  });
  if (!product || product.variants.length === 0) return null;
  const fit = byOrder(FIT_ORDER);
  const colour = byOrder(COLOUR_ORDER);
  const size = byOrder(SIZE_ORDER);
  return {
    ...product,
    collectionName: collectionName(product.collection),
    variants: [...product.variants].sort(
      (a, b) => fit(a.fit, b.fit) || colour(a.colour, b.colour) || size(a.size, b.size),
    ),
  };
}

/** Name and style for the mockup of a published design, or null. */
export async function getArtworkSubject(
  db: PrismaClient,
  slug: string,
): Promise<{ name: string; style: 'statement' | 'small-logo' } | null> {
  const product = await db.product.findFirst({
    where: { slug, status: 'published' },
    select: { name: true, collection: true },
  });
  if (!product) return null;
  return {
    name: product.name,
    style: product.collection === 'basics' ? 'small-logo' : 'statement',
  };
}
