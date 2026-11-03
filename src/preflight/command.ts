// `pdf-export preflight` (spec 001 T024, contracts/cli.md): the book's preflight alone, with
// the book's flags, so a release's inputs can be checked before the book is made. `book`
// (T029) runs the same checks first. Exit 0 with no fault, 1 with any (one line each,
// `fault <fault>`), 2 on bad arguments, a graph that cannot be reached at the start, or any
// other error during the checks, after printing the faults found before it.
import {
  graphSettings,
  openGraph,
  type Graph,
  type GraphOptions,
  type GraphSettings,
} from '../graph/connection.ts';
import { releaseInfo, type ReleaseInfo } from '../graph/queries.ts';
import { preflight, type PreflightSettings } from './preflight.ts';

export class SettingsError extends Error {
  override name = 'SettingsError';
}

const FLAGS = ['--graph', '--database', '--files', '--figures', '--species'];

/** The settings from the flags and the environment; the credentials from the environment. */
export function preflightSettings(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): PreflightSettings & { graph: GraphSettings } {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const [name = '', inline] = (args[i] ?? '').split(/=(.*)/s, 2);
    if (!FLAGS.includes(name)) throw new SettingsError(`Unknown argument: ${name}`);
    const value = inline ?? args[++i];
    if (value === undefined || value === '') throw new SettingsError(`${name} needs a value`);
    if (flags.has(name)) throw new SettingsError(`${name} is given twice`);
    flags.set(name, value);
  }
  const required = (flag: string): string => {
    const value = flags.get(flag);
    if (value === undefined) throw new SettingsError(`${flag} is needed`);
    return value;
  };
  const graphEnv = { ...env };
  const uri = flags.get('--graph');
  if (uri !== undefined) graphEnv['NEO4J_URI'] = uri;
  const database = flags.get('--database');
  if (database !== undefined) graphEnv['NEO4J_DATABASE'] = database;
  let graph: GraphSettings;
  try {
    graph = graphSettings(graphEnv);
  } catch {
    throw new SettingsError('--graph (or NEO4J_URI) is needed');
  }
  return {
    graph,
    files: required('--files'),
    figures: required('--figures'),
    species: flags.get('--species') ?? 'Homo sapiens',
  };
}

/** `pdf-export preflight`: its exit code; faults to `out`, errors to `err`. */
export async function preflightCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  {
    out,
    err,
    open = openGraph,
  }: {
    out: (text: string) => void;
    err: (text: string) => void;
    /** How the graph is opened (a test gives one that fails). */
    open?: (settings: GraphSettings, options?: GraphOptions) => Graph;
  }
): Promise<number> {
  let settings;
  try {
    settings = preflightSettings(args, env);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    err(`${error.message}\n`);
    return 2;
  }
  // the start's check, its own driver retrying a failed read briefly, so a graph that cannot
  // be reached is said within seconds, not after the driver's default half minute
  // (opened inside the try: the driver throws at once on an address it cannot parse)
  let start: Graph | undefined;
  let release: ReleaseInfo;
  try {
    start = open(settings.graph, { connectionTimeoutMs: 5000, retryTimeMs: 0 });
    release = await releaseInfo(start);
  } catch (error) {
    err(`The graph cannot be read: ${message(error)}\n`);
    return 2;
  } finally {
    await closing(start, err);
  }
  // the checks' reads with the driver's own retries (opened inside the try, as above)
  const faults: string[] = [];
  let failure: { error: unknown } | null = null;
  let graph: Graph | undefined;
  try {
    graph = open(settings.graph);
    await preflight(graph, release, settings, faults);
  } catch (error) {
    failure = { error };
  } finally {
    await closing(graph, err);
  }
  // the faults found first, then the error that stopped the checks, if one did
  for (const fault of faults) out(`fault ${fault}\n`);
  if (failure) {
    err(`The preflight stopped: ${message(failure.error)}\n`);
    return 2;
  }
  return faults.length > 0 ? 1 : 0;
}

/**
 * A graph closed, a failure to close said on stderr and never thrown: a rejection in a
 * `finally` would replace the command's exit code with an error.
 */
export async function closing(graph: Graph | undefined, err: (text: string) => void) {
  try {
    await graph?.close();
  } catch (error) {
    err(`The graph did not close: ${message(error)}\n`);
  }
}

export const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
