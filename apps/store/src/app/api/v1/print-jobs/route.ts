import { businessNow } from '@switch-gear/shared/clock';
import { printStatusSchema } from '@switch-gear/shared/printhub';
import { z } from 'zod';
import { authorize } from '../../../../server/auth';
import { getDb } from '../../../../server/db';
import { errorResponse, parseJson, parseQuery } from '../../../../server/http';
import { createPrintJob, listPrintJobs, PrintJobError } from '../../../../server/printhub';

const query = z.object({ status: printStatusSchema.optional() });
const body = z.object({ orderNumber: z.string().regex(/^ORD-\d{1,12}$/) }).strict();
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'print_jobs:read');
  if ('response' in auth) return auth.response;
  const parsed = parseQuery(request, query);
  if ('response' in parsed) return parsed.response;
  return Response.json(await listPrintJobs(db, parsed.data.status));
}
export async function POST(request: Request): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'print_jobs:write');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, body);
  if ('response' in parsed) return parsed.response;
  try {
    const job = await createPrintJob(db, parsed.data.orderNumber, {
      simUrl: process.env.SIM_URL ?? 'http://localhost:4000',
      now: await businessNow(),
    });
    return Response.json(job, { status: 201 });
  } catch (err) {
    if (err instanceof PrintJobError)
      return errorResponse(err.status, err.code, { message: err.message });
    throw err;
  }
}
