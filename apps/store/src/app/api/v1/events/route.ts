import { z } from 'zod';
import { authorize } from '../../../../server/auth';
import { getDb } from '../../../../server/db';
import { EVENTS_DEFAULT_LIMIT, EVENTS_MAX_LIMIT, listEvents } from '../../../../server/events';
import { parseQuery } from '../../../../server/http';

/** Event.seq is a Postgres INTEGER; a cursor past it can't match anything and Prisma rejects it. */
const MAX_SEQ = 2_147_483_647;

const query = z.object({
  after: z.coerce.number().int().min(0).max(MAX_SEQ).default(0),
  limit: z.coerce.number().int().min(1).max(EVENTS_MAX_LIMIT).default(EVENTS_DEFAULT_LIMIT),
});

// GET /api/v1/events?after=<seq>&limit=<n> — outbox events in seq order (needs the events:read scope: hq or founder).
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'events:read');
  if ('response' in auth) return auth.response;

  const parsed = parseQuery(request, query);
  if ('response' in parsed) return parsed.response;
  return Response.json(await listEvents(db, parsed.data.after, parsed.data.limit));
}
