import { DEFAULT_PORTS } from '@switch-gear/shared';
import { buildApp } from './app';

const port = Number(process.env.SIM_PORT ?? DEFAULT_PORTS.sim);
const app = buildApp();

app.listen({ port, host: '0.0.0.0' }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
