// A summation's coloured text (T040): release 98 numbers a cycle's steps in red with
// `<font color=red>`, as its figure numbers them, and the website shows them red. The PDF
// prints them in the theme's red, its error colour, and paints nothing outside the theme.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { hexOf, lookFaults, lookOf } from '../../src/check/look.ts';
import { htmlPage, pageStyles } from '../../src/layout/document.ts';
import { themeVariables } from '../../src/layout/theme.ts';
import { sanitiseSummation } from '../../src/model/rules.ts';
import { Printer } from '../../src/print/print.ts';

let printer: Printer;
before(async () => {
  printer = await Printer.start();
});
after(async () => {
  await printer.close();
});

test("a summation's red step numbers print in the theme's error colour", async () => {
  const red = hexOf(themeVariables().get('--mat-sys-error') ?? '');
  assert.ok(red);
  const summation = sanitiseSummation(
    '<p><font color=red>(1)</font> A placeholder step. <font color=red>(2)</font> Another.</p>'
  );
  const body = `<div class="summation">${summation}</div>`;
  const pdf = await printer.print(htmlPage('Colour', 'single', body, pageStyles(), ''), false);
  const { colours } = await lookOf(pdf);
  assert.ok(colours.has(red), JSON.stringify([...colours.keys()]));
  assert.deepEqual(await lookFaults(pdf), []);
});
