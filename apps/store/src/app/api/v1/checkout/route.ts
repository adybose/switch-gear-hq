import { businessNow } from '@switch-gear/shared/clock';
import { CheckoutError, placeOrder } from '../../../../server/checkout';
import { getDb } from '../../../../server/db';
import { errorResponse, parseJson } from '../../../../server/http';
import { orderPath } from '../../../../server/order-link';
import { checkoutInput } from '../../../../server/validation/checkout';

// POST /api/v1/checkout — public; places an order and returns where to pay.
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, checkoutInput);
  if ('response' in parsed) return parsed.response;

  try {
    const { orderNumber, pricing } = await placeOrder(getDb(), parsed.data, await businessNow());
    // Until PayMock (T-07) exists, "paying" means landing on the order confirmation page.
    const paymentUrl = new URL(orderPath(orderNumber), request.url).toString();
    return Response.json({ orderNumber, totalPaise: pricing.totalPaise, paymentUrl }, { status: 201 });
  } catch (err) {
    if (err instanceof CheckoutError) {
      return errorResponse(422, err.code, { [err.field]: err.message });
    }
    throw err;
  }
}
