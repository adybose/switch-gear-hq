import { businessNow } from '@switch-gear/shared/clock';
import { z } from 'zod';
import { authorize } from '../../../../../../server/auth';
import { getDb } from '../../../../../../server/db';
import { errorResponse } from '../../../../../../server/http';
import { createPrintJob, PrintJobError } from '../../../../../../server/printhub';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'print_jobs:write');
  if ('response' in auth) return auth.response;
  const parsed = z
    .string()
    .min(1)
    .max(100)
    .safeParse((await params).id);
  if (!parsed.success) return errorResponse(422, 'validation_failed');
  const job = await db.printJob.findUnique({
    where: { id: parsed.data },
    include: { order: { select: { number: true } } },
  });
  if (!job) return errorResponse(404, 'not_found');
  try {
    const result = await createPrintJob(db, job.order.number, {
      simUrl: process.env.SIM_URL ?? 'http://localhost:4000',
      now: await businessNow(),
      reprintId: job.id,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PrintJobError)
      return errorResponse(err.status, err.code, { message: err.message });
    throw err;
  }
}
