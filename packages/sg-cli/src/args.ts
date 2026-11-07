/** What a flag holds: text, a rupee amount (sent as paise), a whole number, or on/off. */
export type FlagType = 'string' | 'rupees' | 'int' | 'bool';

export interface FlagSpec {
  type: FlagType;
  required?: boolean;
  /** Key in the query string or JSON body; defaults to the flag name. */
  key?: string;
  /** Allowed values for a string flag. */
  choices?: readonly string[];
}

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
  json: boolean;
  help: boolean;
}

/** Splits argv into positionals and `--flag value` / `--flag=value` / `--flag` pieces. */
export function parseArgv(argv: string[], boolFlags: ReadonlySet<string>): ParsedArgs {
  const parsed: ParsedArgs = { positionals: [], flags: new Map(), json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg.startsWith('--') && arg.length > 2) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) parsed.flags.set(name, arg.slice(eq + 1));
      else if (boolFlags.has(name)) parsed.flags.set(name, true);
      else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) parsed.flags.set(name, true);
        else {
          parsed.flags.set(name, next);
          i++;
        }
      }
    } else parsed.positionals.push(arg);
  }
  return parsed;
}
