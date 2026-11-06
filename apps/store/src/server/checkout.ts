import { priceOrder, type Pricing } from '@switch-gear/shared/pricing';
import { checkPincode, type Serviceability } from '@switch-gear/shared/shipping';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { recordEvent } from './events';
import type { CheckoutInput, QuoteInput } from './validation/checkout';

type Db = PrismaClient | Prisma.TransactionClient;

/** A checkout the customer can fix: unknown SKU, bad PIN, invalid code. Maps to 422. */
export class CheckoutError extends Error {
  override name = 'CheckoutError';
  constructor(
    readonly code:
      'unknown_sku' | 'too_many' | 'invalid_pincode' | 'not_serviceable' | 'discount_code_invalid',
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

interface CatalogueLine {
  sku: string;
  qty: number;
  variantId: string;
  unitPricePaise: number;
}

/** Merges repeated SKUs and prices every line from the catalogue (never from the client). */
async function catalogueLines(
  db: Db,
  items: { sku: string; qty: number }[],
): Promise<CatalogueLine[]> {
  const qtyBySku = new Map<string, number>();
  for (const { sku, qty } of items) qtyBySku.set(sku, (qtyBySku.get(sku) ?? 0) + qty);
  for (const [sku, qty] of qtyBySku) {
    if (qty > 10) throw new CheckoutError('too_many', `You can order up to 10 of ${sku}.`, 'items');
  }

  const variants = await db.variant.findMany({
    where: { sku: { in: [...qtyBySku.keys()] }, active: true, product: { status: 'published' } },
    select: { id: true, sku: true, pricePaise: true },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));
  return [...qtyBySku].map(([sku, qty]) => {
    const variant = bySku.get(sku);
    if (!variant) {
      throw new CheckoutError('unknown_sku', `${sku} is not available any more.`, 'items');
    }
    return { sku, qty, variantId: variant.id, unitPricePaise: variant.pricePaise };
  });
}

/** Percent off for a code that is active right now (business time), or an error message. */
async function lookUpCode(
  db: Db,
  code: string,
  now: Date,
): Promise<{ code: string; percent: number } | { error: string }> {
  const found = await db.discountCode.findFirst({
    where: { code: { equals: code.trim(), mode: 'insensitive' } },
  });
  const valid =
    found &&
    found.status === 'active' &&
    found.startsAt <= now &&
    (found.endsAt === null || found.endsAt > now);
  return valid
    ? { code: found.code, percent: found.percent }
    : { error: `The code ${code.trim().toUpperCase()} isn't valid or has expired.` };
}

export interface Quote {
  pricing: Pricing;
  /** Code that was applied, if any. */
  discountCode: string | null;
  discountCodeError: string | null;
  shipping: Serviceability | null;
}

/** Totals for the checkout page. Problems with the code or PIN are reported, not thrown. */
export async function quoteCheckout(db: Db, input: QuoteInput, now: Date): Promise<Quote> {
  const lines = await catalogueLines(db, input.items);
  const code = input.discountCode ? await lookUpCode(db, input.discountCode, now) : null;
  const applied = code && 'percent' in code ? code : null;
  const pricing = priceOrder({
    lines,
    codePercent: applied?.percent,
    state: input.state ?? 'Karnataka',
  });
  return {
    pricing,
    discountCode: applied && pricing.discountSource === 'code' ? applied.code : null,
    discountCodeError: code && 'error' in code ? code.error : null,
    shipping: input.pincode ? checkPincode(input.pincode) : null,
  };
}

export interface PlacedOrder {
  orderNumber: string;
  pricing: Pricing;
}

/**
 * Places an order: checks the PIN and code, prices from the catalogue, reuses the customer
 * by email, creates the order (`placed`) and writes `order.placed`, all in one transaction.
 */
export async function placeOrder(
  db: PrismaClient,
  input: CheckoutInput,
  now: Date,
): Promise<PlacedOrder> {
  const shipping = checkPincode(input.customer.pincode);
  if (!shipping.serviceable) {
    throw new CheckoutError(shipping.reason, shipping.message, 'customer.pincode');
  }

  return db.$transaction(async (tx) => {
    const lines = await catalogueLines(tx, input.items);
    let applied: { code: string; percent: number } | null = null;
    if (input.discountCode) {
      const code = await lookUpCode(tx, input.discountCode, now);
      if ('error' in code)
        throw new CheckoutError('discount_code_invalid', code.error, 'discountCode');
      applied = code;
    }
    const pricing = priceOrder({
      lines,
      codePercent: applied?.percent,
      state: input.customer.state,
    });

    const email = input.customer.email.toLowerCase();
    const details = { ...input.customer, email };
    const existing = await tx.customer.findFirst({
      where: { email },
      orderBy: { createdAt: 'asc' },
    });
    const customer = existing
      ? await tx.customer.update({ where: { id: existing.id }, data: details })
      : await tx.customer.create({ data: details });

    const [{ n }] = await tx.$queryRaw<[{ n: bigint }]>`SELECT nextval('order_number_seq') AS n`;
    const orderNumber = `ORD-${n}`;

    await tx.order.create({
      data: {
        number: orderNumber,
        customerId: customer.id,
        status: 'placed',
        subtotalPaise: pricing.subtotalPaise,
        discountPaise: pricing.discountPaise,
        shippingPaise: pricing.shippingPaise,
        taxPaise: pricing.taxPaise,
        totalPaise: pricing.totalPaise,
        discountCode: pricing.discountSource === 'code' ? applied!.code : null,
        source: input.source,
        placedAt: now,
        items: {
          create: lines.map((l) => ({
            variantId: l.variantId,
            qty: l.qty,
            unitPricePaise: l.unitPricePaise,
          })),
        },
      },
    });

    await recordEvent(tx, {
      type: 'order.placed',
      entityType: 'order',
      entityId: orderNumber,
      payload: {
        orderNumber,
        totalPaise: pricing.totalPaise,
        itemCount: pricing.itemCount,
        source: input.source,
      },
      at: now,
    });

    return { orderNumber, pricing };
  });
}

/** What the confirmation page shows. */
export async function getOrderSummary(db: PrismaClient, orderNumber: string) {
  return db.order.findUnique({
    where: { number: orderNumber },
    select: {
      number: true,
      status: true,
      subtotalPaise: true,
      discountPaise: true,
      shippingPaise: true,
      taxPaise: true,
      totalPaise: true,
      discountCode: true,
      placedAt: true,
      customer: { select: { name: true, city: true, state: true, pincode: true } },
      items: {
        select: {
          qty: true,
          unitPricePaise: true,
          variant: {
            select: {
              sku: true,
              fit: true,
              colour: true,
              size: true,
              product: { select: { name: true, slug: true } },
            },
          },
        },
      },
    },
  });
}
