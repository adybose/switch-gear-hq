import { businessNow } from '@switch-gear/shared/clock';
import { authorize } from '../../../../../../server/auth';
import { getDb } from '../../../../../../server/db';
import { errorResponse, parseJson } from '../../../../../../server/http';
import { replyToTicket } from '../../../../../../server/tickets';
import { ticketReplyInput } from '../../../../../../server/validation/tickets';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'ticket_replies:write');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, ticketReplyInput);
  if ('response' in parsed) return parsed.response;
  const { number } = await params;
  const ticket = await replyToTicket(db, number, parsed.data, await businessNow());
  return ticket ? Response.json(ticket) : errorResponse(404, 'not_found');
}
