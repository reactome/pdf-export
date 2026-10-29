#!/usr/bin/env node
// pdf-export's command line (contracts/cli.md). Its commands come with spec 001's tasks:
// book, check-book, compare and serve. Until then it prints its usage.

export const USAGE = `Usage: pdf-export <command> [options]

Commands:
  book         write the release's book (spec 001, User Story 1)
  check-book   check a book for FR-011's faults
  compare      compare with event-pdf's output, by meaning (FR-012)
  serve        the website's single-event PDF service (User Story 2)
`;

/** What the command line answers for its arguments: the exit code and what it prints. */
export function run(args: readonly string[]): { code: number; out: string } {
  const [command] = args;
  if (command === undefined || command === '--help' || command === '-h') {
    return { code: 0, out: USAGE };
  }
  return { code: 2, out: `Unknown command: ${command}\n\n${USAGE}` };
}

if (import.meta.main) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(out);
  process.exitCode = code;
}
