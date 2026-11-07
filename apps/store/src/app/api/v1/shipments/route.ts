import { shipmentStatusSchema } from '@switch-gear/shared/shipfast';
import { z } from 'zod';
import { authorize } from '../../../../server/auth';
import { getDb } from '../../../../server/db';
import { errorResponse, parseJson, parseQuery } from '../../../../server/http';
import { createShipment, listShipments, ShipmentError } from '../../../../server/shipfast';

const query = z.object({ status: shipmentStatusSchema.optional() });
const body = z.object({ orderNumber: z.string().regex(/^ORD-\d{1,12}$/) }).strict();
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'shipments:read');
  if ('response' in auth) return auth.response;
  const parsed = parseQuery(request, query);
  if ('response' in parsed) return parsed.response;
  return Response.json(await listShipments(db, parsed.data.status));
}
export async function POST(request: Request): Promise<Response> {
  const db = getDb();
  const auth = await authorize(db, request, 'shipments:write');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, body);
  if ('response' in parsed) return parsed.response;
  try {
    return Response.json(await createShipment(db, parsed.data.orderNumber), { status: 201 });
  } catch (err) {
    if (err instanceof ShipmentError)
      return errorResponse(err.status, err.code, { message: err.message });
    throw err;
  }
}
