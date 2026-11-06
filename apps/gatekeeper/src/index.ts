import { DEFAULT_PORTS } from '@switch-gear/shared';
import { createHealthServer } from './health';

const port = Number(process.env.GATEKEEPER_PORT ?? DEFAULT_PORTS.gatekeeper);

createHealthServer().listen(port, '0.0.0.0', () => {
  console.log(`gatekeeper health on :${port}`);
});
