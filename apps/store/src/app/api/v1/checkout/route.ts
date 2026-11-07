import { businessNow } from '@switch-gear/shared/clock';
import { CheckoutError, placeOrder } from '../../../../server/checkout';
import { getDb } from '../../../../server/db';
import { errorResponse, parseJson } from '../../../../server/http';
import { payPath } from '../../../../server/order-link';
import { checkoutInput } from '../../../../server/validation/checkout';

// POST /api/v1/checkout — public; places an order and returns where to pay.
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, checkoutInput);
  if ('response' in parsed) return parsed.response;

  try {
    const { orderNumber, pricing } = await placeOrder(getDb(), parsed.data, await businessNow());
    // Opens the PayMock page for this order (see app/pay/[number]/route.ts).
    const paymentUrl = new URL(payPath(orderNumber), request.url).toString();
    return Response.json({ orderNumber, totalPaise: pricing.totalPaise, paymentUrl }, { status: 201 });
  } catch (err) {
    if (err instanceof CheckoutError) {
      return errorResponse(422, err.code, { [err.field]: err.message });
    }
    throw err;
  }
}
