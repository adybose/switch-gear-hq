import { z } from 'zod';
import { authorize } from '../../../../server/auth';
import { getDb } from '../../../../server/db';
import { parseQuery } from '../../../../server/http';
import { listOrders } from '../../../../server/orders';

const query = z.object({
  status: z
    .enum(['placed', 'paid', 'printing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// GET /api/v1/orders — orders:read (fulfilment, support, hq, founder).
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'orders:read');
  if ('response' in auth) return auth.response;
  const parsed = parseQuery(request, query);
  if ('response' in parsed) return parsed.response;
  return Response.json(await listOrders(db, parsed.data.status, parsed.data.limit));
}
