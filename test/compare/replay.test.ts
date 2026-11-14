// The replay (spec 002 T020, SC-202): its cases, its comparison of two answers, and its run
// against two made-up services on loopback, each check seen failing on a planted difference.
// The tokens are the stub's made-up ones; nothing here reaches a real service.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import {
  callFourRefusals,
  compareAnswers,
  fileName,
  frameworkForm,
  replay,
  replayCases,
  replayTokens,
  serviceBody,
  type Answer,
  type ReplayCase,
} from '../../src/compare/replay.ts';
import { canonicalToken } from '../../src/analysis/token.ts';
import { REPORT_TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';

const TOKENS = replayTokens(REPORT_TOKENS.overrepresentation, new Date('2026-11-13T12:00:00Z'));
const CASES = replayCases(TOKENS);

const PDF: Answer = {
  status: 200,
  contentType: 'application/pdf;charset=UTF-8',
  fileName: 'report.pdf',
  body: null,
  pdf: true,
  accepted: 0,
};
const notFound = (): Answer => ({
  status: 404,
  contentType: 'application/json;charset=UTF-8',
  fileName: null,
  body: serviceBody(404, 'Not Found'),
  pdf: false,
  accepted: 0,
});
const framework400 = (time: string): Answer => ({
  status: 400,
  contentType: 'application/json;charset=UTF-8',
  fileName: 'f.txt',
  body: JSON.stringify({ timestamp: time, status: 400, error: 'Bad Request', path: '/a' }),
  pdf: false,
  accepted: 0,
});
const plain: ReplayCase = { name: 'plain', path: '/x' };

describe('the replay', () => {
  test('its cases: T001s set, the doubled parameters and a flag of a space', () => {
    const names = CASES.map((c) => c.name);
    for (const name of [
      'the defaults',
      'number=abc',
      'importableOnly=maybe',
      'importableOnly=%20',
      'token gone',
      'token holding %2F',
      'number=7&number=abc',
      'importableOnly=true&importableOnly=maybe',
      'resource=UNIPROT&resource=ENSEMBL',
    ]) {
      assert.ok(names.includes(name), name);
    }
    assert.equal(new Set(names).size, names.length);
    // the unknown and gone tokens are of the form the service issues, so the service judges
    // them by their date, not their form
    assert.doesNotThrow(() => canonicalToken(TOKENS.unknown));
    assert.doesNotThrow(() => canonicalToken(TOKENS.gone));
    assert.equal(
      Buffer.from(decodeURIComponent(TOKENS.gone), 'base64').toString().slice(0, 8),
      '20261113'
    );
    const listed = CASES.filter((c) => c.listed).map((c) => c.name);
    assert.deepEqual(listed, ['importableOnly=%20', 'token malformed', 'token holding %2F']);
  });

  test('the same answers are the same, a PDF named without a charset among them', () => {
    assert.deepEqual(compareAnswers(plain, PDF, { ...PDF, contentType: 'application/pdf' }), {
      differences: [],
      listed: false,
    });
    assert.deepEqual(compareAnswers(plain, notFound(), notFound()).differences, []);
  });

  test("the framework's 400 is compared by its form, its time apart", () => {
    const today = framework400('2026-11-13T10:00:00.123+00:00');
    const ours = framework400('2026-11-13T10:00:41.007+00:00');
    assert.deepEqual(compareAnswers(plain, today, ours).differences, []);
    // a time in another form, or another path, is a difference
    assert.deepEqual(
      compareAnswers(plain, today, framework400('2026-11-13T10:00:41.007Z')).differences,
      ['body']
    );
    const elsewhere = { ...ours, body: (ours.body ?? '').replace('"/a"', '"/b"') };
    assert.deepEqual(compareAnswers(plain, today, elsewhere).differences, ['body']);
    assert.equal(frameworkForm('not json'), 'not json');
  });

  test('a status, a type, a file name or a body that differs is found', () => {
    assert.deepEqual(
      compareAnswers(plain, notFound(), { ...notFound(), status: 410 }).differences,
      ["status 410, today's 404"]
    );
    assert.deepEqual(
      compareAnswers(plain, notFound(), { ...notFound(), contentType: 'application/json' })
        .differences,
      ["Content-Type application/json, today's application/json;charset=UTF-8"]
    );
    assert.deepEqual(compareAnswers(plain, PDF, { ...PDF, fileName: 'x.pdf' }).differences, [
      "file name x.pdf, today's report.pdf",
    ]);
    assert.deepEqual(
      compareAnswers(plain, notFound(), { ...notFound(), body: serviceBody(404, 'Gone') })
        .differences,
      ['body']
    );
    // an error's type is compared whole: only a PDF's charset is let go
    assert.deepEqual(
      compareAnswers(plain, PDF, { ...notFound(), status: 200, contentType: 'text/html' })
        .differences,
      [
        "Content-Type text/html, today's application/pdf;charset=UTF-8",
        "file name null, today's report.pdf",
        'not a PDF',
      ]
    );
  });

  test('a listed difference holds only with the listed answer', () => {
    const malformed = CASES.find((c) => c.name === 'token malformed');
    assert.ok(malformed);
    const today500: Answer = {
      ...notFound(),
      status: 500,
      body: '{"code":500,"reason":"Internal Server Error","messages":["…"]}\n',
    };
    assert.deepEqual(compareAnswers(malformed, today500, notFound()), {
      differences: [],
      listed: true,
    });
    // today's 500 copied is not the listed 404
    assert.deepEqual(compareAnswers(malformed, today500, today500).differences, [
      'status 500, listed 404',
      'body not the listed one',
      "today's answer, where a difference is listed",
    ]);
    const space = CASES.find((c) => c.name === 'importableOnly=%20');
    assert.ok(space);
    assert.deepEqual(compareAnswers(space, today500, PDF).differences, []);
    assert.deepEqual(compareAnswers(space, today500, notFound()).differences, [
      'status 404, listed 200',
      'not a PDF, listed one',
    ]);
    // the listing is wrong if today's answers the same
    assert.deepEqual(compareAnswers(space, PDF, PDF).differences, [
      "today's answer, where a difference is listed",
    ]);
  });

  test('a file name from Content-Disposition, quoted or not', () => {
    assert.equal(fileName('attachment; filename="report.pdf"'), 'report.pdf');
    assert.equal(fileName('inline;filename=f.txt'), 'f.txt');
    assert.equal(fileName(null), null);
  });
});

/** A made-up service answering every request by `answer`, counting them. */
async function service(
  answer: (req: IncomingMessage, res: ServerResponse, count: number) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  let count = 0;
  const server = createServer((req, res) => {
    count += 1;
    answer(req, res, count);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

const pdfAnswer = (res: ServerResponse, type: string): void => {
  res
    .writeHead(200, {
      'Content-Type': type,
      'Content-Disposition': 'attachment; filename="report.pdf"',
    })
    .end('%PDF-1.7\n…');
};

describe('the replay, run', () => {
  test("pdf-export's 202 is followed to its PDF, and counted", async () => {
    const today = await service((_req, res) => {
      pdfAnswer(res, 'application/pdf;charset=UTF-8');
    });
    const ours = await service((_req, res, count) => {
      if (count < 3) res.writeHead(202, { 'Content-Type': 'application/json' }).end('{}');
      else pdfAnswer(res, 'application/pdf');
    });
    const waiting = await service((_req, res) => {
      res.writeHead(202, { 'Content-Type': 'application/json' }).end('{}');
    });
    try {
      const [result] = await replay({ today: today.url, ours: ours.url, cases: [plain] });
      assert.ok(result);
      assert.deepEqual(result.differences, []);
      assert.equal(result.ours.accepted, 2);
      assert.equal(result.today.accepted, 0);
      // not followed past its time: the 202 is the answer, and a difference
      const [late] = await replay({
        today: today.url,
        ours: waiting.url,
        cases: [plain],
        followMs: 0,
      });
      assert.ok(late);
      assert.ok(late.differences.includes("status 202, today's 200"));
    } finally {
      await today.close();
      await ours.close();
      await waiting.close();
    }
  });

  test('a planted difference on the wire is found', async () => {
    const today = await service((_req, res) => {
      pdfAnswer(res, 'application/pdf;charset=UTF-8');
    });
    const ours = await service((_req, res) => {
      res
        .writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="other.pdf"',
        })
        .end('%PDF-1.7\n');
    });
    try {
      const [result] = await replay({ today: today.url, ours: ours.url, cases: [plain] });
      assert.deepEqual(result?.differences, ["file name other.pdf, today's report.pdf"]);
    } finally {
      await today.close();
      await ours.close();
    }
  });
});

describe("call 4's refusals", () => {
  let stub: AnalysisStub;
  let root: string;
  before(async () => {
    stub = await startAnalysisStub();
    root = stub.url.replace(/\/AnalysisService$/, '');
  });
  after(async () => {
    await stub.close();
  });

  test('the stub against itself agrees', async () => {
    const at = { root, token: REPORT_TOKENS.overrepresentation };
    assert.deepEqual(await callFourRefusals(at, at), []);
  });

  test('a service answering otherwise is found', async () => {
    const other = await service((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      const body = JSON.stringify({
        timestamp: new Date().toISOString().replace('Z', '+00:00'),
        status: 415,
        error: 'Unsupported Media Type',
        path,
      });
      // a 415 for both, where the stub's empty body is a 400
      res.writeHead(415, { 'Content-Type': 'application/json;charset=UTF-8' }).end(body);
    });
    try {
      const differences = await callFourRefusals(
        { root, token: REPORT_TOKENS.overrepresentation },
        { root: other.url, token: REPORT_TOKENS.overrepresentation }
      );
      assert.deepEqual(differences, [
        "an empty body: 415, the stub's 400",
        "an empty body: the body's form",
      ]);
    } finally {
      await other.close();
    }
  });
});
