#!/usr/bin/env node
// pdf-export's command line (contracts/cli.md). Its commands come with spec 001's tasks:
// serve (T022) runs the single-event service; preflight (T024) runs the book's preflight
// alone; figures (T046) draws the book's figures into a folder; book (T029) writes the
// book; check-book and compare are to come.

export const USAGE = `Usage: pdf-export <command> [options]

Commands:
  book         write the release's book (spec 001, User Story 1)
  check-book   check a book for FR-011's faults
  compare      compare with event-pdf's output, by meaning (FR-012)
  figures      draw the book's figures into a folder, before the book (SC-010)
  preflight    check the book's inputs, as book does before printing
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
  // the handlers set before the service says it serves: one who signals it on reading that
  // line would otherwise find none, and the process die by the signal, the service unclosed.
  // SIGHUP too: the browser launcher no longer handles it (src/print/print.ts)
  const stopped = new Promise<void>((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
      process.once(signal, () => {
        resolve();
      });
  });
  process.stderr.write(`serving at ${service.url}\n`);
  await stopped;
  await service.close();
  return 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === 'serve') {
    process.exitCode = await serve(args.slice(1));
  } else if (args[0] === 'book') {
    const { bookCommand } = await import('./book/command.ts');
    process.exitCode = await bookCommand(args.slice(1), process.env, {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
  } else if (args[0] === 'preflight') {
    const { preflightCommand } = await import('./preflight/command.ts');
    process.exitCode = await preflightCommand(args.slice(1), process.env, {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
  } else if (args[0] === 'figures') {
    const { figuresCommand } = await import('./figures/step.ts');
    process.exitCode = await figuresCommand(args.slice(1), process.env, {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
  } else {
    const { code, out } = run(args);
    (code === 0 ? process.stdout : process.stderr).write(out);
    process.exitCode = code;
  }
}
