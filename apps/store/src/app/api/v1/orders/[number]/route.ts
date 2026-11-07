import { authorize } from '../../../../../server/auth';
import { getDb } from '../../../../../server/db';
import { errorResponse } from '../../../../../server/http';
import { getOrder } from '../../../../../server/orders';

// GET /api/v1/orders/{number} — orders:read.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ number: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'orders:read');
  if ('response' in auth) return auth.response;
  const order = await getOrder(db, (await ctx.params).number);
  return order ? Response.json(order) : errorResponse(404, 'not_found');
}
