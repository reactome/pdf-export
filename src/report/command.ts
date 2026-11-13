// `pdf-export report` (spec 002 T011): one analysis report, from the graph, the analysis
// service and the render service, written to a file: for the comparison (T019) and for checks
// by hand. The service (T012) makes reports with the same `makeReport`. Exit 0 with the
// report written, 1 when it could not be made (one line saying why, never the token), 2 on
// bad arguments.
import { writeFileSync } from 'node:fs';

import { graphSettings, openGraph, type GraphSettings } from '../graph/connection.ts';
import { readSummary } from '../preflight/files.ts';
import { Printer } from '../print/print.ts';
import { Slots } from './figures.ts';
import { reportParameters } from './model.ts';
import { ReportError, makeReport, type ReportRequest } from './report.ts';

export class SettingsError extends Error {
  override name = 'SettingsError';
}

const FLAGS = [
  '--token',
  '--species',
  '--number',
  '--resource',
  '--importable-only',
  '-o',
  '--graph',
  '--database',
  '--files',
  '--render',
  '--analysis',
  '--site',
  '--concurrency',
];
/** The flags that take no value. */
const SWITCHES = ['--importable-only'];

export interface ReportSettings {
  request: ReportRequest;
  out: string;
  graph: GraphSettings;
  /** The release's folder: its EHLD summary says which pathways are illustrated. */
  files: string;
  render: string;
  analysis: string;
  site: string;
  /** Figures asked of the render service at once. */
  concurrency: number;
}

/** The settings from the flags and the environment, as `serve`'s are read. */
export function reportSettings(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): ReportSettings {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const [name = '', inline] = (args[i] ?? '').split(/=(.*)/s, 2);
    if (!FLAGS.includes(name)) throw new SettingsError(`Unknown argument: ${name}`);
    if (flags.has(name)) throw new SettingsError(`${name} is given twice`);
    if (SWITCHES.includes(name)) {
      if (inline !== undefined) throw new SettingsError(`${name} takes no value`);
      flags.set(name, 'true');
      continue;
    }
    const value = inline ?? args[++i];
    if (value === undefined || value === '') throw new SettingsError(`${name} needs a value`);
    flags.set(name, value);
  }
  const setting = (flag: string, variable?: string): string | undefined =>
    flags.get(flag) ?? (variable === undefined ? undefined : env[variable] || undefined);
  const required = (flag: string, variable?: string): string => {
    const value = setting(flag, variable);
    if (value === undefined) {
      throw new SettingsError(`${flag}${variable ? ` (or ${variable})` : ''} is needed`);
    }
    return value;
  };
  // the number read and clamped as the report's address reads it
  const query = new URLSearchParams();
  const number = flags.get('--number');
  if (number !== undefined) query.set('number', number);
  const parameters = reportParameters(query);
  if ('invalid' in parameters) throw new SettingsError('--number must be a whole number');
  const concurrency = setting('--concurrency') ?? '2';
  if (!/^[0-9]+$/.test(concurrency) || Number(concurrency) < 1 || Number(concurrency) > 100) {
    throw new SettingsError('--concurrency must be a whole number from 1 to 100');
  }
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
    request: {
      token: required('--token'),
      species: required('--species'),
      number: parameters.number,
      resource: flags.get('--resource'),
      importableOnly: flags.has('--importable-only'),
    },
    out: required('-o'),
    graph,
    files: required('--files'),
    render: required('--render', 'RENDER_SERVICE'),
    analysis: required('--analysis', 'ANALYSIS_SERVICE'),
    site: required('--site', 'REACTOME_SITE'),
    concurrency: Number(concurrency),
  };
}

export const REPORT_USAGE = `Usage: pdf-export report --token <token> --species <species> -o <file>
  [--number <1-50>] [--resource <resource>] [--importable-only]
  [--graph <uri>] [--database <name>] --files <release folder>
  --render <url> --analysis <url> --site <url> [--concurrency <n>]
`;

/** `pdf-export report`: its exit code; lines to `err`. */
export async function reportCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: { out: (text: string) => void; err: (text: string) => void }
): Promise<number> {
  let settings: ReportSettings;
  try {
    settings = reportSettings(args, env);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    io.err(`${error.message}\n\n${REPORT_USAGE}`);
    return 2;
  }
  const summary = readSummary(settings.files);
  if (!summary) {
    io.err(`No EHLD summary in ${settings.files}\n`);
    return 2;
  }
  const graph = openGraph(settings.graph);
  const printer = await Printer.start();
  try {
    const { pdf, model } = await makeReport(settings.request, {
      graph,
      printer,
      analysis: settings.analysis,
      render: settings.render,
      site: settings.site,
      illustrated: summary.illustrated,
      slots: new Slots(settings.concurrency),
      log: (line) => {
        io.err(`${line}\n`);
      },
    });
    writeFileSync(settings.out, pdf);
    io.out(`${settings.out}: ${String(model.pathways.length)} pathways\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof ReportError)) throw error;
    io.err(`report: ${error.reason}: ${error.message}\n`);
    return 1;
  } finally {
    await printer.close();
    await graph.close();
  }
}
