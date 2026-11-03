#!/usr/bin/env node
// pdf-export's command line (contracts/cli.md). Its commands come with spec 001's tasks:
// serve (T022) runs the single-event service; book, check-book and compare are to come.

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

/** `pdf-export serve`: the service, until it is stopped; bad arguments are exit 2. */
export async function serve(args: readonly string[]): Promise<number> {
  // loaded only here: the service starts a browser and a graph driver
  const { SettingsError, serveSettings, startService } = await import('./serve.ts');
  let settings;
  try {
    settings = serveSettings(args, process.env);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  const service = await startService(settings);
  process.stderr.write(`serving at ${service.url}\n`);
  await new Promise<void>((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        resolve();
      });
  });
  await service.close();
  return 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === 'serve') {
    process.exitCode = await serve(args.slice(1));
  } else {
    const { code, out } = run(args);
    (code === 0 ? process.stdout : process.stderr).write(out);
    process.exitCode = code;
  }
}
