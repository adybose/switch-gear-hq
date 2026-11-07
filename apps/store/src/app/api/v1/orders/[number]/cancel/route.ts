import { businessNow } from '@switch-gear/shared/clock';
import { authorize } from '../../../../../../server/auth';
import { getDb } from '../../../../../../server/db';
import { errorResponse } from '../../../../../../server/http';
import { cancelOrder, OrderError } from '../../../../../../server/orders';

// POST /api/v1/orders/{number}/cancel — order_cancel:write (fulfilment).
export async function POST(
  request: Request,
  ctx: { params: Promise<{ number: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'order_cancel:write');
  if ('response' in auth) return auth.response;
  try {
    return Response.json(await cancelOrder(db, (await ctx.params).number, await businessNow()));
  } catch (err) {
    if (err instanceof OrderError)
      return errorResponse(err.status, err.code, { message: err.message });
    throw err;
  }
}
