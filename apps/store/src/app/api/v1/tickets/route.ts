import { businessNow } from '@switch-gear/shared/clock';
import { getDb } from '../../../../server/db';
import { parseJson } from '../../../../server/http';
import { createTicket } from '../../../../server/tickets';
import { ticketInput } from '../../../../server/validation/tickets';

// POST /api/v1/tickets — public; the website contact and return form.
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJson(request, ticketInput);
  if ('response' in parsed) return parsed.response;
  const { ticketNumber } = await createTicket(getDb(), parsed.data, await businessNow());
  return Response.json({ ticketNumber }, { status: 201 });
}
