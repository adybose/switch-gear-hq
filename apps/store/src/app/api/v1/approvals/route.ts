import { z } from 'zod';
import { approvalJson, listApprovals } from '../../../../server/approvals';
import { authorize } from '../../../../server/auth';
import { getDb } from '../../../../server/db';
import { parseQuery } from '../../../../server/http';

const query = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
});

// GET /api/v1/approvals?status= — approval requests, newest first (approvals:read: hq, founder).
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'approvals:read');
  if ('response' in auth) return auth.response;

  const parsed = parseQuery(request, query);
  if ('response' in parsed) return parsed.response;
  return Response.json((await listApprovals(db, parsed.data.status)).map(approvalJson));
}
