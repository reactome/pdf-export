// The render and content stubs (test/stubs) as servers of their own, for CI's run of the image
// (spec 001 T037): `figures` draws the fixture's figures from them. Writes their base URLs to
// the file named by its argument, as JSON, and runs until it is stopped.
import { writeFileSync } from 'node:fs';
import { startContentStub } from '../../test/stubs/content.ts';
import { startRenderStub } from '../../test/stubs/render.ts';

const file = process.argv[2];
if (!file) throw new Error('usage: node ci/image/stubs.ts <file for the URLs>');
const render = await startRenderStub();
const content = await startContentStub();
writeFileSync(file, JSON.stringify({ render: render.url, content: content.url }) + '\n');
const stop = () => void Promise.all([render.close(), content.close()]).then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
