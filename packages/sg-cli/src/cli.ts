// The `sg` command. Real commands (orders, refunds, approvals, ...) arrive in T-23.

export const HELP = `sg — Switch Gear store CLI

Usage: sg <command> [options]

Commands:
  help       Show this help

Set SG_API_KEY and SG_STORE_URL in the environment.`;

export interface CliResult {
  code: number;
  out: string;
}

export function run(argv: string[]): CliResult {
  const [command] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { code: 0, out: HELP };
  }
  return { code: 1, out: `sg: unknown command '${command}'\n\n${HELP}` };
}
