import { approvalJson } from '../../../../../server/approvals';
import { authorize } from '../../../../../server/auth';
import { getDb } from '../../../../../server/db';
import { errorResponse } from '../../../../../server/http';

// GET /api/v1/approvals/{id} — one approval by its number, e.g. APR-7 (approvals:read).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'approvals:read');
  if ('response' in auth) return auth.response;

  const { id } = await params;
  const approval = await db.approvalRequest.findUnique({ where: { number: id } });
  if (!approval) return errorResponse(404, 'not_found', { id: `No approval ${id}.` });
  return Response.json(approvalJson(approval));
}
