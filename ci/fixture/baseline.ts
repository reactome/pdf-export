// Writes the fixture's baseline (spec 001 T036): the reduced form of each PDF in a folder, by
// name, as `pdf-export compare --reduced` reads it. CI compares each pull request's fixture
// book and single-event PDF with `ci/fixture/expected.json`; a change to what they print is
// made with that file written again here, in the same pull request.
//
//   node ci/fixture/baseline.ts <folder of PDFs> <baseline.json>
import { writeFileSync } from 'node:fs';
import { baselineOf } from '../../src/compare/compare.ts';

const [folder, out] = process.argv.slice(2);
if (!folder || !out) throw new Error('usage: node ci/fixture/baseline.ts <folder> <baseline.json>');
writeFileSync(out, await baselineOf(folder));
