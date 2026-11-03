// A figure's link to its interactive form on the website (spec 001 T008, FR-003).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Links } from '../../src/layout/html.ts';

const SITE = 'https://site.example/';

describe("a figure's link", () => {
  for (const book of [false, true]) {
    const links = new Links(book, SITE, new Set());
    const where = book ? 'in the book' : 'in a single PDF';

    test(`a pathway's diagram opens in the Pathway Browser, ${where}`, () => {
      assert.equal(
        links.figure({ kind: 'diagram', stId: 'R-HSA-1' }, 'R-HSA-1'),
        'https://site.example/PathwayBrowser/#/R-HSA-1'
      );
      assert.equal(
        links.figure({ kind: 'ehld', stId: 'R-HSA-2' }, 'R-HSA-2'),
        'https://site.example/PathwayBrowser/#/R-HSA-2'
      );
    });

    test(`one drawn in an ancestor's diagram opens that, the event selected, ${where}`, () => {
      assert.equal(
        links.figure({ kind: 'ancestor', stId: 'R-HSA-1', highlight: ['R-HSA-3'] }, 'R-HSA-2'),
        'https://site.example/PathwayBrowser/#/R-HSA-1&SEL=R-HSA-2'
      );
    });

    test(`a reaction's opens its page, ${where}`, () => {
      assert.equal(
        links.figure({ kind: 'reaction', stId: 'R-HSA-4' }, 'R-HSA-4'),
        'https://site.example/content/detail/R-HSA-4'
      );
    });
  }
});
