#!/usr/bin/env node
// The replay (spec 002 T020, SC-202): T001's requests for the report's address sent to
// today's analysis service and to pdf-export's `serve`, one at a time, each pair compared
// (src/compare/replay.ts); then call 4's refusals, the analysis service's against T004's
// stub. Both services are private copies, on loopback: never a production service.
//
//   node ci/replay.ts --today http://127.0.0.1:8080 --ours http://127.0.0.1:4391 \
//     --token-file <file holding a token of made-up identifiers>
//
// The token is read from a file so it reaches no command line or log. What is printed holds
// no token, identifier or body. The exit code is 1 on any difference not listed.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  callFourRefusals,
  described,
  replay,
  replayCases,
  replayTokens,
} from '../src/compare/replay.ts';
import { REPORT_TOKENS, startAnalysisStub } from '../test/stubs/analysis.ts';

const { values } = parseArgs({
  options: {
    today: { type: 'string' },
    ours: { type: 'string' },
    'token-file': { type: 'string' },
    pause: { type: 'string', default: '2000' },
    only: { type: 'string' },
  },
});
if (!values.today || !URL.canParse(values.today)) throw new Error('--today must be a URL');
if (!values.ours || !URL.canParse(values.ours)) throw new Error('--ours must be a URL');
if (!values['token-file']) throw new Error('--token-file is needed');
const token = readFileSync(values['token-file'], 'utf8').trim();

const only = values.only === undefined ? null : new RegExp(values.only);
const cases = replayCases(replayTokens(token, new Date())).filter(
  (c) => only === null || only.test(c.name)
);
let unlisted = 0;
const results = await replay({
  today: values.today,
  ours: values.ours,
  cases,
  pauseMs: Number(values.pause),
  onResult: (r) => {
    const verdict =
      r.differences.length > 0
        ? `DIFFERENT: ${r.differences.join('; ')}`
        : r.listed
          ? 'listed difference'
          : 'same';
    if (r.differences.length > 0) unlisted += 1;
    console.log(`${r.name}\n  today's: ${described(r.today)}\n  ours:    ${described(r.ours)}`);
    console.log(`  ${verdict}`);
  },
});

const stub = await startAnalysisStub();
try {
  const call4 = await callFourRefusals(
    { root: stub.url.replace(/\/AnalysisService$/, ''), token: REPORT_TOKENS.overrepresentation },
    { root: values.today, token }
  );
  console.log(`call 4's refusals: ${call4.length === 0 ? 'as the stub' : call4.join('; ')}`);
  if (call4.length > 0) unlisted += 1;
} finally {
  await stub.close();
}
console.log(
  `${String(results.length)} cases, ${String(results.filter((r) => r.listed).length)} listed, ${String(unlisted)} different`
);
process.exitCode = unlisted > 0 ? 1 : 0;
