import { parseArgv, type FlagSpec } from './args';
import { COMMANDS, type Command } from './commands';
import { loadConfig } from './env';
import { formatBody } from './format';
import { parseRupees } from './money';

export interface CliResult {
  code: number;
  out: string;
}

/** Everything the CLI touches outside itself, so tests can fake it. */
export interface CliDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  cwd: string;
  readFile?: (path: string) => string;
}

const BOOL_FLAGS: ReadonlySet<string> = new Set(
  COMMANDS.flatMap((c) =>
    Object.entries(c.flags ?? {})
      .filter(([, spec]) => spec.type === 'bool')
      .map(([name]) => name),
  ),
);

const GROUPS = [...new Set(COMMANDS.map((c) => c.words[0]!))];

function usageLine(cmd: Command): string {
  const args = (cmd.args ?? []).map((a) => `<${a.name}>`).join(' ');
  const flags = Object.entries(cmd.flags ?? {})
    .map(([name, spec]) => {
      const piece =
        spec.type === 'bool'
          ? `--${name}`
          : `--${name} <${spec.type === 'rupees' ? 'rupees' : spec.type}>`;
      return spec.required ? piece : `[${piece}]`;
    })
    .join(' ');
  return ['sg', ...cmd.words, args, flags].filter(Boolean).join(' ');
}

export const HELP = `sg — Switch Gear store CLI

Usage: sg <command> [options]

Commands:
${GROUPS.map((g) => {
  const subs = COMMANDS.filter((c) => c.words[0] === g);
  return `  ${g.padEnd(17)}${
    subs
      .map((c) => c.words.slice(1).join(' '))
      .filter(Boolean)
      .join(', ') || subs[0]!.summary
  }`;
}).join('\n')}

Options:
  --json       Print the raw JSON response
  --help, -h   Show help (also: sg <command> --help)

Amounts are in rupees (--amount 799). Needs SG_API_URL and SG_API_KEY in the environment or
in the .env of the working folder. An action over a limit prints
"Waiting for founder approval: APR-n" and the founder decides.`;

function commandHelp(cmd: Command): string {
  return `${cmd.summary}\n\nUsage: ${usageLine(cmd)}\nExample: ${cmd.example}`;
}

function groupHelp(group: string): string {
  const lines = COMMANDS.filter((c) => c.words[0] === group).map(
    (c) => `  ${usageLine(c)}\n      ${c.summary}`,
  );
  return `sg ${group}\n\n${lines.join('\n')}`;
}

const usageError = (message: string, cmd?: Command): CliResult => ({
  code: 2,
  out: `sg: ${message}${cmd ? `\nUsage: ${usageLine(cmd)}` : "\nRun 'sg help' for the commands."}`,
});

type Built = { path: string; query: URLSearchParams; body?: Record<string, unknown> } | CliResult;

function convertFlag(
  name: string,
  spec: FlagSpec,
  raw: string | true,
): { value: unknown } | { error: string } {
  if (spec.type === 'bool') return { value: raw === true || raw === 'true' };
  if (raw === true) return { error: `--${name} needs a value` };
  if (spec.type === 'rupees') {
    const paise = parseRupees(raw);
    return paise === null
      ? { error: `--${name} must be an amount in rupees like 799 or 799.50, got '${raw}'` }
      : { value: paise };
  }
  if (spec.type === 'int') {
    return /^\d+$/.test(raw)
      ? { value: Number(raw) }
      : { error: `--${name} must be a whole number, got '${raw}'` };
  }
  if (spec.choices && !spec.choices.includes(raw)) {
    return { error: `--${name} must be one of: ${spec.choices.join(', ')}` };
  }
  return { value: raw };
}

function build(cmd: Command, positionals: string[], flags: Map<string, string | true>): Built {
  const args = cmd.args ?? [];
  if (positionals.length !== args.length) {
    return usageError(
      positionals.length < args.length
        ? `missing <${args[positionals.length]!.name}>`
        : `unexpected '${positionals[args.length]}'`,
      cmd,
    );
  }
  const specs = cmd.flags ?? {};
  for (const name of flags.keys()) {
    if (!(name in specs)) return usageError(`unknown option --${name}`, cmd);
  }

  let path = cmd.path;
  const sent: Record<string, unknown> = { ...cmd.fixed };
  args.forEach((arg, i) => {
    const value = positionals[i]!;
    if (arg.in === 'path') path = path.replace(`{${arg.name}}`, encodeURIComponent(value));
    else sent[arg.key ?? arg.name] = value;
  });
  for (const arg of args) {
    if (arg.type !== 'onoff') continue;
    const key = arg.key ?? arg.name;
    const text = String(sent[key]).toLowerCase();
    if (text !== 'on' && text !== 'off')
      return usageError(`<${arg.name}> must be 'on' or 'off'`, cmd);
    sent[key] = text === 'on';
  }
  for (const [name, spec] of Object.entries(specs)) {
    const raw = flags.get(name);
    if (raw === undefined) {
      if (spec.required) return usageError(`--${name} is required`, cmd);
      continue;
    }
    const converted = convertFlag(name, spec, raw);
    if ('error' in converted) return usageError(converted.error, cmd);
    sent[spec.key ?? name] = converted.value;
  }

  if (cmd.method === 'GET') {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(sent)) query.set(k, String(v));
    return { path, query };
  }
  return { path, query: new URLSearchParams(), body: sent };
}

function findCommand(words: string[]): Command | undefined {
  return COMMANDS.find((c) => c.words.every((w, i) => words[i] === w));
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** `{error, details}` from the API as one short line. */
function describeError(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error, details } = body as { error: unknown; details?: unknown };
    const more =
      details && typeof details === 'object'
        ? ': ' +
          Object.entries(details)
            .map(([k, v]) => `${k} ${String(v)}`)
            .join('; ')
        : '';
    return `${status} ${String(error)}${more}`;
  }
  // A web page or empty body: the endpoint probably isn't built yet.
  return `${status} ${status === 404 ? 'not found (endpoint not available in the store yet?)' : 'request failed'}`;
}

export async function run(argv: string[], deps: CliDeps): Promise<CliResult> {
  const parsed = parseArgv(argv, BOOL_FLAGS);
  const { positionals } = parsed;
  const [first] = positionals;

  if (first === undefined || first === 'help') {
    const topic = first === 'help' ? positionals[1] : undefined;
    const found = topic ? findCommand(positionals.slice(1)) : undefined;
    if (found) return { code: 0, out: commandHelp(found) };
    if (topic && GROUPS.includes(topic)) return { code: 0, out: groupHelp(topic) };
    return { code: 0, out: HELP };
  }

  // Longest match first, so `sg ledger` is found even with arguments after it.
  const cmd = findCommand(positionals);
  if (!cmd) {
    if (GROUPS.includes(first)) {
      return parsed.help || positionals.length === 1
        ? { code: positionals.length === 1 && !parsed.help ? 2 : 0, out: groupHelp(first) }
        : usageError(`unknown command '${positionals.slice(0, 2).join(' ')}'`);
    }
    return usageError(`unknown command '${first}'`);
  }
  if (parsed.help) return { code: 0, out: commandHelp(cmd) };

  const built = build(cmd, positionals.slice(cmd.words.length), parsed.flags);
  if ('code' in built) return built;

  const config = loadConfig(deps.env, deps.cwd, deps.readFile);
  if ('error' in config) return { code: 2, out: `sg: ${config.error}` };

  const query = built.query.toString();
  const url = `${config.baseUrl}${built.path}${query ? `?${query}` : ''}`;
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: cmd.method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        accept: 'application/json',
        ...(built.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(built.body ? { body: JSON.stringify(built.body) } : {}),
    });
  } catch (err) {
    return {
      code: 1,
      out: `sg: could not reach ${config.baseUrl} (${err instanceof Error ? err.message : 'network error'})`,
    };
  }

  const body = await readBody(res);
  if (!res.ok) return { code: 1, out: `sg: ${describeError(res.status, body)}` };

  if (res.status === 202) {
    const id =
      typeof body === 'object' && body !== null && 'approvalId' in body
        ? String(body.approvalId)
        : null;
    if (parsed.json) return { code: 0, out: JSON.stringify(body, null, 2) };
    return {
      code: 0,
      out: id ? `Waiting for founder approval: ${id}` : 'Waiting for founder approval.',
    };
  }
  return { code: 0, out: parsed.json ? JSON.stringify(body, null, 2) : formatBody(body) };
}
