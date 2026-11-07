import { authorize } from '../../../../../server/auth';
import { getDb } from '../../../../../server/db';
import { errorResponse } from '../../../../../server/http';
import { getTicket } from '../../../../../server/tickets';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'tickets:read');
  if ('response' in auth) return auth.response;
  const { number } = await params;
  const ticket = await getTicket(db, number);
  return ticket ? Response.json(ticket) : errorResponse(404, 'not_found');
}
