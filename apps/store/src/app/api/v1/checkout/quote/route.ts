import { businessNow } from '@switch-gear/shared/clock';
import { CheckoutError, quoteCheckout } from '../../../../../server/checkout';
import { getDb } from '../../../../../server/db';
import { errorResponse, parseJson } from '../../../../../server/http';
import { quoteInput } from '../../../../../server/validation/checkout';

// POST /api/v1/checkout/quote — public; totals for a cart before placing the order.
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, quoteInput);
  if ('response' in parsed) return parsed.response;

  try {
    const quote = await quoteCheckout(getDb(), parsed.data, await businessNow());
    const p = quote.pricing;
    return Response.json({
      itemCount: p.itemCount,
      subtotalPaise: p.subtotalPaise,
      discountSource: p.discountSource,
      discountPercent: p.discountPercent,
      discountPaise: p.discountPaise,
      shippingPaise: p.shippingPaise,
      taxPaise: p.taxPaise,
      totalPaise: p.totalPaise,
      discountCode: quote.discountCode,
      discountCodeError: quote.discountCodeError,
      pincode: quote.shipping,
    });
  } catch (err) {
    if (err instanceof CheckoutError) {
      return errorResponse(422, err.code, { [err.field]: err.message });
    }
    throw err;
  }
}
