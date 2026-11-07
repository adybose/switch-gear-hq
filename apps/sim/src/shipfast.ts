import {
  SHIPMENT_COST,
  shipmentCreateSchema,
  type ShipmentAccepted,
  type ShipmentCreate,
  type ShipmentStatus,
  type ShipmentWebhookData,
} from '@switch-gear/shared/shipfast';
import { checkPincode, ORIGIN_PIN_PREFIX } from '@switch-gear/shared/shipping';
import {
  SIGNATURE_HEADER,
  signWebhook,
  verifyWebhook,
  type WebhookEnvelope,
} from '@switch-gear/shared/webhooks';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SimClock } from './clock';

export interface ShipfastOptions {
  clock: SimClock;
  storeUrl: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  random?: () => number;
  tickEveryMs?: number;
}
interface Step {
  status: ShipmentStatus;
  at: number;
  attempts: number;
  reason?: string;
}
interface Parcel {
  input: ShipmentCreate;
  accepted: ShipmentAccepted;
  steps: Step[];
  cursor: number;
  pending?: string;
  stopped?: boolean;
}
export interface Shipfast {
  tick(): Promise<void>;
}
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Clock-driven courier with one initial delivery and at most two retries. */
export function registerShipfast(app: FastifyInstance, options: ShipfastOptions): Shipfast {
  const parcels = new Map<string, Parcel>();
  const random = options.random ?? Math.random;
  const doFetch = options.fetch ?? globalThis.fetch;
  let running: Promise<void> | undefined;
  async function drain(): Promise<void> {
    const now = options.clock.now().getTime();
    for (const parcel of parcels.values()) {
      while (!parcel.stopped && parcel.cursor < parcel.steps.length) {
        const step = parcel.steps[parcel.cursor]!;
        if (step.at > now) break;
        if (!parcel.pending) {
          const data: ShipmentWebhookData = {
            awb: parcel.accepted.awb,
            orderRef: parcel.input.orderRef,
            orderNumber: parcel.input.orderNumber,
            sequence: parcel.input.sequence,
            status: step.status,
            attempts: step.attempts,
            costPaise: parcel.accepted.costPaise * (step.status === 'returned_to_origin' ? 2 : 1),
            ...(step.reason ? { reason: step.reason } : {}),
          };
          const envelope: WebhookEnvelope<ShipmentWebhookData> = {
            eventId: `evt_${randomUUID()}`,
            type: 'shipment.status',
            occurredAt: new Date(step.at).toISOString(),
            data,
          };
          parcel.pending = JSON.stringify(envelope);
        }
        const raw = parcel.pending;
        const response = await doFetch(new URL('/api/v1/webhooks/shipfast', options.storeUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SIGNATURE_HEADER]: signWebhook(options.secret, raw),
          },
          body: raw,
          signal: AbortSignal.timeout(3000),
        }).catch(() => null);
        const status = response?.status ?? 0;
        if (status === 409 && step.status === 'pickup_scheduled') {
          const body = (await response!.json().catch(() => null)) as { error?: string } | null;
          if (body?.error === 'unknown_shipment') break;
        }
        if (status === 0 || status >= 500) break;
        if (status < 200 || status >= 300) {
          parcel.stopped = true;
          app.log.warn({ awb: parcel.accepted.awb, status }, 'shipfast webhook refused');
          break;
        }
        parcel.pending = undefined;
        parcel.cursor++;
      }
    }
  }
  function tick(): Promise<void> {
    running ??= drain().finally(() => {
      running = undefined;
    });
    return running;
  }
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(null, undefined);
      }
    });
    scope.post('/shipfast/v1/shipments', async (req, reply) => {
      const raw = (req as { rawBody?: string }).rawBody ?? '';
      const sig = req.headers[SIGNATURE_HEADER.toLowerCase()];
      if (!verifyWebhook(options.secret, raw, typeof sig === 'string' ? sig : null))
        return reply.code(401).send({ error: 'bad_signature' });
      const parsed = shipmentCreateSchema.safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(422)
          .send({ error: 'validation_failed', details: { body: parsed.error.message } });
      const input = parsed.data;
      const area = checkPincode(input.drop.pincode);
      if (!area.serviceable) return reply.code(422).send({ error: area.reason });
      if (!input.pickup.pincode.startsWith(ORIGIN_PIN_PREFIX))
        return reply.code(422).send({ error: 'unsupported_pickup' });
      const key = `${input.orderRef}:${input.sequence}`;
      const existing = parcels.get(key);
      if (existing) {
        if (JSON.stringify(existing.input) !== JSON.stringify(input))
          return reply.code(409).send({ error: 'shipment_conflict' });
        return reply.code(201).send(existing.accepted);
      }
      if (input.sequence > 1 || input.reshipOfAwb) {
        const previous = [...parcels.values()].find((p) => p.accepted.awb === input.reshipOfAwb);
        if (
          !previous ||
          previous.input.orderRef !== input.orderRef ||
          previous.input.orderNumber !== input.orderNumber ||
          previous.input.sequence + 1 !== input.sequence ||
          !['lost', 'returned_to_origin'].includes(previous.steps.at(-1)!.status) ||
          previous.cursor !== previous.steps.length ||
          JSON.stringify(previous.input.drop) !== JSON.stringify(input.drop) ||
          JSON.stringify(previous.input.pickup) !== JSON.stringify(input.pickup) ||
          previous.input.weightGrams !== input.weightGrams
        )
          return reply.code(409).send({ error: 'invalid_reship' });
      }
      const now = options.clock.now().getTime();
      const arrival = now + area.transitDays * DAY;
      const accepted: ShipmentAccepted = {
        awb: `SF${randomBytes(10).toString('hex').toUpperCase()}`,
        status: 'pickup_scheduled',
        zone: area.zone,
        attempts: 0,
        costPaise: SHIPMENT_COST[area.zone],
        bookedAt: new Date(now).toISOString(),
        estimatedDeliveryAt: new Date(arrival).toISOString(),
      };
      const steps: Step[] = [
        { status: 'pickup_scheduled', at: now, attempts: 0 },
        { status: 'picked_up', at: now + HOUR, attempts: 0 },
        { status: 'in_transit', at: now + 2 * HOUR, attempts: 0 },
      ];
      if (random() < 0.005)
        steps.push({ status: 'lost', at: now + (arrival - now) / 2, attempts: 0, reason: 'lost' });
      else
        for (let attempt = 1; attempt <= 3; attempt++) {
          const at = arrival + (attempt - 1) * DAY;
          steps.push({ status: 'out_for_delivery', at: at - HOUR, attempts: attempt });
          // Failure rate is unspecified in the spec; use 10% per delivery attempt.
          if (random() >= 0.1) {
            steps.push({ status: 'delivered', at, attempts: attempt });
            break;
          }
          steps.push({
            status: 'delivery_failed',
            at,
            attempts: attempt,
            reason: 'recipient_unavailable',
          });
          if (attempt === 3)
            steps.push({
              status: 'returned_to_origin',
              at: at + DAY,
              attempts: 3,
              reason: 'delivery_attempts_exhausted',
            });
        }
      parcels.set(key, { input, accepted, steps, cursor: 0 });
      return reply.code(201).send(accepted);
    });
  });
  if (options.tickEveryMs) {
    const timer = setInterval(() => {
      void tick().catch((err) => app.log.error(err, 'shipfast tick failed'));
    }, options.tickEveryMs);
    timer.unref();
    app.addHook('onClose', async () => {
      clearInterval(timer);
      await running;
    });
  }
  return { tick };
}
