import { z } from 'zod';
import { apiProducts } from '../../../../../server/catalogue';
import { getDb } from '../../../../../server/db';
import { parseQuery } from '../../../../../server/http';

const query = z.object({ collection: z.string().trim().min(1).max(100).optional() });

export async function GET(request: Request): Promise<Response> {
  const parsed = parseQuery(request, query);
  if ('response' in parsed) return parsed.response;
  return Response.json(await apiProducts(getDb(), parsed.data));
}
