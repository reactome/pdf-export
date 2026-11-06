// What pdf.js gives back, checked: a value of the shape pdf.js gives is read as it is, and
// anything else is refused, or read as none where the PDF may lack it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  annotationRect,
  isPageRef,
  numbersOf,
  outlineOf,
  textTransform,
} from '../../src/print/pdfjs.ts';

test("a page's reference has a number and a generation, both numbers", () => {
  assert.ok(isPageRef({ num: 4, gen: 0 }));
  for (const value of [null, 4, { num: 4 }, { num: '4', gen: 0 }, [4, 0]]) {
    assert.ok(!isPageRef(value), JSON.stringify(value));
  }
});

test("a text item's transform is numbers; an annotation's rect is numbers or none", () => {
  assert.deepEqual(textTransform([1, 0, 0, 1, 72, 700]), [1, 0, 0, 1, 72, 700]);
  assert.throws(() => textTransform(undefined), /transform/);
  assert.throws(() => textTransform([1, '0']), /transform/);
  assert.deepEqual(annotationRect([1, 2, 3, 4]), [1, 2, 3, 4]);
  assert.deepEqual(annotationRect(undefined), []);
  assert.throws(() => annotationRect('1 2 3 4'), /rect/);
});

test("a path's box: a list or a typed array of numbers, or none", () => {
  assert.deepEqual(numbersOf(new Float32Array([1, 2, 3, 4])), [1, 2, 3, 4]);
  assert.deepEqual(numbersOf([1, 2]), [1, 2]);
  for (const value of [null, {}, 'abcd', [1, 'a']]) assert.equal(numbersOf(value), null);
});

test('an outline: none for null, each item titled, the items beneath it read too', () => {
  assert.deepEqual(outlineOf(null), []);
  const outline = [{ title: 'A', dest: 'a', items: [{ title: 'B', dest: null, items: [] }] }];
  assert.deepEqual(outlineOf(outline), outline);
  assert.throws(() => outlineOf({}), /not a list/);
  assert.throws(() => outlineOf([{ dest: 'a', items: [] }]), /no title/);
  assert.throws(() => outlineOf([{ title: 'A', dest: 'a' }]), /not a list/);
});
