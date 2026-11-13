#!/usr/bin/env node
// pdf-export's command line (contracts/cli.md). Its commands come with spec 001's tasks:
// serve (T022) runs the single-event service; preflight (T024) runs the book's preflight
// alone; figures (T046) draws the book's figures into a folder; book (T029) writes the
// book; check-book (T030) checks a written book for FR-011's faults; compare (T035)
// compares with event-pdf's output by FR-012; report (spec 002 T011) makes one analysis
// report.
import { constants as osConstants } from 'node:os';

import { privateTemporary } from './print/temporary.ts';

export const USAGE = `Usage: pdf-export <command> [options]

Commands:
  book         write the release's book (spec 001, User Story 1)
  check-book   check a book for FR-011's faults
  compare      compare with event-pdf's output, by meaning (FR-012)
  figures      draw the book's figures into a folder, before the book (SC-010)
  preflight    check the book's inputs, as book does before printing
  report       one analysis report, to a file (spec 002)
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
  // the process's private temporary folder, first, its removal on exit registered with it:
  // the printer and every browser it starts write theirs in it (src/print/temporary.ts)
  const temporary = privateTemporary('serve');
  // the handlers set before the service is started, as `on`, never `once`: a signal while it
  // starts, or a second while it closes, exits at once (128 and its number), so the exit
  // handlers run, the browser launcher's ending its browser and this one removing the
  // folder; the first once it serves closes it. SIGHUP too: the launcher no longer handles
  // it (src/print/print.ts)
  const state: { serving: boolean; stop: () => void } = { serving: false, stop: () => undefined };
  const stopped = new Promise<void>((resolve) => {
    state.stop = resolve;
  });
  const onSignal = (signal: NodeJS.Signals): void => {
    if (!state.serving) process.exit(128 + osConstants.signals[signal]);
    state.serving = false;
    process.stderr.write(`stopping on ${signal}\n`);
    state.stop();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const signal of signals) process.on(signal, onSignal);
  try {
    const service = await startService(settings);
    state.serving = true;
    process.stderr.write(`serving at ${service.url}\n`);
    await stopped;
    await service.close();
  } finally {
    for (const signal of signals) process.off(signal, onSignal);
    temporary.remove();
  }
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
  } else if (args[0] === 'check-book') {
    const { checkBookCommand } = await import('./check/book.ts');
    process.exitCode = await checkBookCommand(args.slice(1), process.env, {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
  } else if (args[0] === 'compare') {
    const { compareCommand } = await import('./compare/compare.ts');
    process.exitCode = await compareCommand(args.slice(1), {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
  } else if (args[0] === 'report') {
    const { reportCommand } = await import('./report/command.ts');
    process.exitCode = await reportCommand(args.slice(1), process.env, {
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
