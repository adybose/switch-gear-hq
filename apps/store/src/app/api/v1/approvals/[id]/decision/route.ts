import { z } from 'zod';
import { approvalJson, ApprovalError, decideApproval } from '../../../../../../server/approvals';
import { authorize } from '../../../../../../server/auth';
import { getDb } from '../../../../../../server/db';
import { errorResponse, parseJson } from '../../../../../../server/http';

// Gated actions register their executors on import. Each task that adds a gated action
// (refunds, reships, payouts, discount codes, campaigns) imports its module here.

const body = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((b) => b.decision === 'approve' || b.reason !== undefined, {
    path: ['reason'],
    message: 'A reason is required to reject.',
  });

// POST /api/v1/approvals/{id}/decision — founder key only (approval_decisions:write).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'approval_decisions:write');
  if ('response' in auth) return auth.response;

  const parsed = await parseJson(request, body);
  if ('response' in parsed) return parsed.response;

  const { id } = await params;
  try {
    const decided = await decideApproval(db, {
      number: id,
      decision: parsed.data.decision,
      reason: parsed.data.reason ?? null,
      decidedBy: auth.department,
    });
    return Response.json(approvalJson(decided));
  } catch (err) {
    if (err instanceof ApprovalError) return errorResponse(err.status, err.code, { id: err.message });
    throw err;
  }
}
