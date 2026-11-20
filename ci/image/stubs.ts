// The render, content and analysis stubs (test/stubs) as servers of their own, for CI's run of
// the image (spec 001 T037, T036): `figures` draws the fixture's figures from them, and `serve`
// is given them for a single-event PDF. Writes their base URLs to the file named by its
// argument, as JSON, and runs until it is stopped.
import { writeFileSync } from 'node:fs';
import { startAnalysisStub } from '../../test/stubs/analysis.ts';
import { startContentStub } from '../../test/stubs/content.ts';
import { startRenderStub } from '../../test/stubs/render.ts';

const file = process.argv[2];
if (!file) throw new Error('usage: node ci/image/stubs.ts <file for the URLs>');
const render = await startRenderStub();
const content = await startContentStub();
const analysis = await startAnalysisStub();
writeFileSync(
  file,
  JSON.stringify({ render: render.url, content: content.url, analysis: analysis.url }) + '\n'
);
const stop = () =>
  void Promise.all([render.close(), content.close(), analysis.close()]).then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
