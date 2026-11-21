// The printer's pages fetch nothing but files (review of 20 Nov): a page asking for an
// image, a stylesheet or a CSS background over HTTP prints, and no request leaves.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { Printer } from '../../src/print/print.ts';

let printer: Printer;
const seen: string[] = [];
const server = createServer((request, response) => {
  seen.push(request.url ?? '');
  response.end('x');
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  printer = await Printer.start();
});
after(async () => {
  await printer.close();
  server.close();
});

test('a printed page asks nothing of the network', async () => {
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${String(port)}`;
  const html =
    `<!doctype html><html><head><link rel="stylesheet" href="${base}/sheet.css">` +
    `<style>body { background: url("${base}/background.png") }</style></head>` +
    `<body><p>Text</p><img src="${base}/image.png"></body></html>`;
  const pdf = await printer.print(html, false);
  assert.ok(pdf.length > 0);
  assert.deepEqual(seen, []);
});
