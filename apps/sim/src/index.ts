import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORTS } from '@switch-gear/shared';
import { buildApp } from './app';

// npm workspace commands run inside apps/sim; read the same root .env as store scripts.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.SIM_PORT ?? DEFAULT_PORTS.sim);
const app = buildApp();

app.listen({ port, host: '0.0.0.0' }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
