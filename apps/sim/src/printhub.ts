import {
  PRINT_COST,
  printCreateSchema,
  type PrintAccepted,
  type PrintCreate,
  type PrintStatus,
  type PrintWebhookData,
} from '@switch-gear/shared/printhub';
import {
  SIGNATURE_HEADER,
  signWebhook,
  verifyWebhook,
  type WebhookEnvelope,
} from '@switch-gear/shared/webhooks';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SimClock } from './clock';

export interface PrinthubOptions {
  clock: SimClock;
  storeUrl: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  random?: () => number;
  tickEveryMs?: number;
}
interface Step {
  status: PrintStatus;
  at: number;
  skus?: string[];
}
interface Job {
  input: PrintCreate;
  accepted: PrintAccepted;
  steps: Step[];
  cursor: number;
  pending?: string;
  stopped?: boolean;
}
export interface Printhub {
  tick(): Promise<void>;
}
const DAY = 86_400_000;

/** In-memory partner state, as with PayMock. A tick drains due status changes in order. */
export function registerPrinthub(app: FastifyInstance, options: PrinthubOptions): Printhub {
  const jobs = new Map<string, Job>();
  const capacity = new Map<number, number>();
  const random = options.random ?? Math.random;
  const doFetch = options.fetch ?? globalThis.fetch;
  let running: Promise<void> | undefined;

  async function drain(): Promise<void> {
    const now = options.clock.now().getTime();
    for (const job of jobs.values()) {
      while (!job.stopped && job.cursor < job.steps.length) {
        const step = job.steps[job.cursor]!;
        if (step.at > now) break;
        if (!job.pending) {
          const data: PrintWebhookData = {
            partnerRef: job.accepted.partnerRef,
            orderRef: job.input.orderRef,
            orderNumber: job.input.orderNumber,
            attempt: job.input.attempt,
            status: step.status,
            skus: step.skus ?? [],
          };
          const envelope: WebhookEnvelope<PrintWebhookData> = {
            eventId: `evt_${randomUUID()}`,
            type: 'printjob.status',
            occurredAt: new Date(step.at).toISOString(),
            data,
          };
          job.pending = JSON.stringify(envelope);
        }
        const raw = job.pending;
        const response = await doFetch(new URL('/api/v1/webhooks/printhub', options.storeUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SIGNATURE_HEADER]: signWebhook(options.secret, raw),
          },
          body: raw,
          signal: AbortSignal.timeout(3000),
        }).then(
          (res) => res,
          () => null,
        );
        const status = response?.status ?? 0;
        if (status === 409 && step.status === 'received') {
          const body = (await response!.json().catch(() => null)) as { error?: string } | null;
          if (body?.error === 'unknown_printjob') break;
        }
        if (status === 0 || status >= 500) break; // same bytes and eventId on next tick
        if (status < 200 || status >= 300) {
          job.stopped = true;
          app.log.warn({ partnerRef: job.accepted.partnerRef, status }, 'printhub webhook refused');
          break;
        }
        job.pending = undefined;
        job.cursor++;
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
    scope.post('/printhub/v1/print-jobs', async (req, reply) => {
      const raw = (req as { rawBody?: string }).rawBody ?? '';
      const signature = req.headers[SIGNATURE_HEADER.toLowerCase()];
      if (!verifyWebhook(options.secret, raw, typeof signature === 'string' ? signature : null))
        return reply.code(401).send({ error: 'bad_signature' });
      const parsed = printCreateSchema.safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(422)
          .send({ error: 'validation_failed', details: zodDetails(parsed.error) });
      const input = parsed.data;
      const key = `${input.orderRef}:${input.attempt}`;
      const existing = jobs.get(key);
      if (existing) {
        if (JSON.stringify(existing.input) !== JSON.stringify(input))
          return reply.code(409).send({ error: 'job_conflict' });
        return reply.code(201).send(existing.accepted);
      }
      if (input.attempt > 1 || input.reprintOf) {
        const previous = [...jobs.values()].find((j) => j.accepted.partnerRef === input.reprintOf);
        if (
          !previous ||
          previous.input.orderRef !== input.orderRef ||
          previous.input.orderNumber !== input.orderNumber ||
          previous.input.attempt + 1 !== input.attempt ||
          previous.steps.at(-1)?.status !== 'misprint' ||
          previous.cursor !== previous.steps.length ||
          JSON.stringify(previous.input.items) !== JSON.stringify(input.items) ||
          JSON.stringify(previous.input.shipTo) !== JSON.stringify(input.shipTo)
        )
          return reply.code(409).send({ error: 'invalid_reprint' });
      }
      const now = options.clock.now().getTime();
      let day = Math.floor(now / DAY);
      while ((capacity.get(day) ?? 0) >= 50) day++;
      capacity.set(day, (capacity.get(day) ?? 0) + 1);
      const start = Math.max(now, day * DAY);
      const accepted: PrintAccepted = {
        partnerRef: `ph_${randomBytes(10).toString('hex')}`,
        status: 'received',
        acceptedAt: new Date(now).toISOString(),
        costPaise: input.reprintOf
          ? 0
          : input.items.reduce((sum, item) => sum + PRINT_COST[item.fit] * item.qty, 0),
      };
      const steps: Step[] = [{ status: 'received', at: now }];
      const badArtwork = input.items.some((item) => !/^https?:\/\//.test(item.artworkUrl));
      const noBlank = input.items.some(
        (item) => item.fit === 'premium' && item.colour === 'olive' && item.size === 'XXL',
      );
      if (badArtwork || noBlank)
        steps.push({ status: badArtwork ? 'artwork_rejected' : 'blank_out_of_stock', at: now });
      else {
        const misprinted = input.items
          .filter((item) => {
            let bad = false;
            for (let i = 0; i < item.qty; i++) if (random() < 0.03) bad = true;
            return bad;
          })
          .map((item) => item.sku);
        steps.push(
          { status: 'in_production', at: start + 3_600_000 },
          { status: 'quality_check', at: start + DAY },
        );
        if (misprinted.length)
          steps.push({ status: 'misprint', at: start + DAY, skus: misprinted });
        else
          steps.push(
            { status: 'packed', at: start + DAY * 1.5 },
            { status: 'handed_over', at: start + DAY * 1.9 },
          );
      }
      jobs.set(key, { input, accepted, steps, cursor: 0 });
      return reply.code(201).send(accepted);
    });
  });
  if (options.tickEveryMs) {
    const timer = setInterval(() => {
      void tick().catch((err) => app.log.error(err, 'printhub tick failed'));
    }, options.tickEveryMs);
    timer.unref();
    app.addHook('onClose', async () => {
      clearInterval(timer);
      await running;
    });
  }
  return { tick };
}
function zodDetails(error: { message: string }): Record<string, string> {
  return { body: error.message };
}
