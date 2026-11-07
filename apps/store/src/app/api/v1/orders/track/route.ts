import { getDb } from '../../../../../server/db';
import { errorResponse, parseQuery } from '../../../../../server/http';
import { trackOrder } from '../../../../../server/tracking';
import { trackQuery } from '../../../../../server/validation/tickets';

// GET /api/v1/orders/track?number=&email= — public; a wrong pair is a plain 404.
export async function GET(request: Request): Promise<Response> {
  const parsed = parseQuery(request, trackQuery);
  if ('response' in parsed) return parsed.response;
  const tracked = await trackOrder(getDb(), parsed.data.number, parsed.data.email);
  if (!tracked) return errorResponse(404, 'not_found');
  return Response.json(tracked);
}
