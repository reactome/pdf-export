// `pdf-export preflight` (spec 001 T024, contracts/cli.md): the book's preflight alone, with
// the book's flags, so a release's inputs can be checked before the book is made. `book`
// (T029) runs the same checks first. Exit 0 with no fault, 1 with any (one line each,
// `fault <fault>`), 2 on bad arguments or a graph that cannot be reached at the start.
import { graphSettings, openGraph, type Graph, type GraphSettings } from '../graph/connection.ts';
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
  { out, err }: { out: (text: string) => void; err: (text: string) => void }
): Promise<number> {
  let settings;
  try {
    settings = preflightSettings(args, env);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    err(`${error.message}\n`);
    return 2;
  }
  const graph: Graph = openGraph(settings.graph, {
    connectionTimeoutMs: 5000,
    retryTimeMs: 0,
  });
  try {
    let release: ReleaseInfo;
    try {
      release = await releaseInfo(graph);
    } catch (error) {
      err(`The graph cannot be read: ${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
    const { faults } = await preflight(graph, release, settings);
    for (const fault of faults) out(`fault ${fault}\n`);
    return faults.length > 0 ? 1 : 0;
  } finally {
    await graph.close();
  }
}
