import { z } from 'zod';
import { pendingApprovalResponse } from '../../../../../../server/approvals';
import { authorize } from '../../../../../../server/auth';
import { getDb } from '../../../../../../server/db';
import { errorResponse } from '../../../../../../server/http';
import { reshipShipment, ShipmentError } from '../../../../../../server/shipfast';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'reship:write');
  if ('response' in auth) return auth.response;
  const parsed = z
    .string()
    .min(1)
    .max(100)
    .safeParse((await params).id);
  if (!parsed.success) return errorResponse(422, 'validation_failed');
  try {
    const result = await reshipShipment(db, parsed.data);
    return 'approvalId' in result && result.status === 'pending'
      ? pendingApprovalResponse(result)
      : Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ShipmentError)
      return errorResponse(err.status, err.code, { message: err.message });
    throw err;
  }
}
