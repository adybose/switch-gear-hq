import {
  SIGNATURE_HEADER,
  verifyWebhook,
  WEBHOOK_PARTNERS,
  webhookSecret,
  type WebhookPartner,
} from '@switch-gear/shared/webhooks';
import { getDb } from '../../../../../server/db';
import { errorResponse } from '../../../../../server/http';
import { fieldErrors } from '../../../../../server/validation/checkout';
import '../../../../../server/paymock';
import { envelopeSchema, processWebhook, WebhookRejected } from '../../../../../server/webhooks';

// POST /api/v1/webhooks/{paymock|printhub|shipfast} — signed partner callbacks.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ partner: string }> },
): Promise<Response> {
  const { partner } = await params;
  if (!(WEBHOOK_PARTNERS as readonly string[]).includes(partner)) {
    return errorResponse(404, 'not_found');
  }
  const p = partner as WebhookPartner;

  // Verify against the exact bytes received, before parsing anything.
  const rawBody = await request.text();
  if (!verifyWebhook(webhookSecret(p), rawBody, request.headers.get(SIGNATURE_HEADER))) {
    return errorResponse(401, 'bad_signature');
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(422, 'invalid_json');
  }
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    return errorResponse(422, 'validation_failed', fieldErrors(envelope.error));
  }

  try {
    const status = await processWebhook(getDb(), p, envelope.data);
    return Response.json({ eventId: envelope.data.eventId, status });
  } catch (err) {
    if (err instanceof WebhookRejected) {
      return errorResponse(409, err.code, { data: err.message });
    }
    throw err;
  }
}
