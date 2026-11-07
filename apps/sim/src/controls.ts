import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SimClock } from './clock';
import type { OrderGenerator } from './generator';

const speedInput = z.strictObject({ speed: z.union([z.literal(1), z.literal(144)]) });
const generatorInput = z
  .strictObject({
    enabled: z.boolean().optional(),
    seed: z.number().int().min(0).max(4294967295).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export function registerControls(app: FastifyInstance, clock: SimClock, generator: OrderGenerator) {
  const reading = () => ({ now: clock.now().toISOString(), speed: clock.speed() });
  app.get('/sim/clock', async () => reading());
  app.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      const expected = Buffer.from(
        `Basic ${Buffer.from(
          `${process.env.FOUNDER_EMAIL || 'founder@example.com'}:${process.env.FOUNDER_PASSWORD || 'test-only-founder-password'}`,
        ).toString('base64')}`,
      );
      const actual = Buffer.from(request.headers.authorization ?? '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return reply
          .header('www-authenticate', 'Basic realm="Switch Gear demo"')
          .code(401)
          .send({ error: 'unauthorized' });
      }
      // Browsers send Origin on mutations; refuse cross-origin writes with cached Basic auth.
      const origin = request.headers.origin;
      if (origin && origin !== `${request.protocol}://${request.headers.host}`) {
        return reply.code(403).send({ error: 'cross_origin_forbidden' });
      }
      reply.header('cache-control', 'no-store');
    });
    scope.get('/sim/admin', async (_request, reply) => reply.type('text/html').send(controlPage));
    scope.get('/sim/generator', async () => generator.status());
    scope.put('/sim/clock', async (request, reply) => {
      const parsed = speedInput.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: 'validation_failed' });
      if (!('setSpeed' in clock) || typeof clock.setSpeed !== 'function') {
        return reply.code(409).send({ error: 'clock_read_only' });
      }
      clock.setSpeed(parsed.data.speed);
      return reading();
    });
    scope.put('/sim/generator', async (request, reply) => {
      const parsed = generatorInput.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: 'validation_failed' });
      try {
        return generator.configure(parsed.data);
      } catch (error) {
        return reply
          .code(409)
          .send({ error: 'generator_busy', details: { message: (error as Error).message } });
      }
    });
  });
}

const controlPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo controls · Switch Gear</title>
<style>body{font:16px system-ui;margin:2rem auto;padding:0 1rem;max-width:40rem;color:#171717;background:#fafafa}button,input{font:inherit;padding:.6rem;margin:.3rem}section{padding:1rem 0;border-top:1px solid #ddd}output{display:block;white-space:pre-wrap;overflow-wrap:anywhere}button{cursor:pointer}label{display:block}</style>
</head><body><p>Demo store. No real payments or deliveries.</p><h1>Demo controls</h1>
<section><h2>Business clock</h2><output id="clock"></output>
<button id="real">Real time · 1×</button><button id="demo">Demo · 1 day in 10 minutes</button></section>
<section><h2>Order generator</h2><p>30 orders per business day. All customers are fictional. Stop before changing the seed.</p>
<button id="start">Start orders</button><button id="stop">Stop orders</button>
<label>Seed <input id="seed" type="number" min="0" max="4294967295" value="42"></label><button id="reseed">Apply seed while stopped</button>
<output id="generator"></output><p id="error" role="alert"></p></section>
<script>
async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if(!response.ok) throw new Error(data.details?.message || data.error);
  return data;
}
async function refresh(){
  try {
    const [clock,generator] = await Promise.all([request('/sim/clock'),request('/sim/generator')]);
    document.getElementById('clock').textContent=clock.now+' · '+clock.speed+'×';
    document.getElementById('generator').textContent=JSON.stringify(generator,null,2);
  } catch(error){document.getElementById('error').textContent=error.message;}
}
async function change(path,body){
  try{await request(path,body);document.getElementById('error').textContent='';await refresh();}
  catch(error){document.getElementById('error').textContent=error.message;}
}
document.getElementById('real').onclick=()=>change('/sim/clock',{speed:1});
document.getElementById('demo').onclick=()=>change('/sim/clock',{speed:144});
document.getElementById('start').onclick=()=>change('/sim/generator',{enabled:true});
document.getElementById('stop').onclick=()=>change('/sim/generator',{enabled:false});
document.getElementById('reseed').onclick=()=>change('/sim/generator',{seed:Number(document.getElementById('seed').value)});
refresh();setInterval(refresh,2000);
</script></body></html>`;
