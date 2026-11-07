import { run } from './cli';

const { code, out } = await run(process.argv.slice(2), {
  fetch,
  env: process.env,
  cwd: process.cwd(),
});
(code === 0 ? console.log : console.error)(out);
process.exitCode = code;
