import { businessNow } from '@switch-gear/shared/clock';
import { authorize } from '../../../../server/auth';
import { getDb } from '../../../../server/db';
import { parseJson, parseQuery } from '../../../../server/http';
import { createTicket, listTickets } from '../../../../server/tickets';
import { ticketInput, ticketListQuery } from '../../../../server/validation/tickets';

// GET /api/v1/tickets — support queue (tickets:read: support, hq, founder).
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'tickets:read');
  if ('response' in auth) return auth.response;
  const parsed = parseQuery(request, ticketListQuery);
  if ('response' in parsed) return parsed.response;
  return Response.json(await listTickets(db, parsed.data.status));
}

// POST /api/v1/tickets — public; the website contact and return form.
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, ticketInput);
  if ('response' in parsed) return parsed.response;
  const { ticketNumber } = await createTicket(getDb(), parsed.data, await businessNow());
  return Response.json({ ticketNumber }, { status: 201 });
}
