// The content stub (spec 001 T046): the one request `pdf-export figures` makes of the content
// service, `GET /data/database/version`, answered as ContentService answers it, the release's
// number as plain text. Its release is settable by a test, also between a figure's render and
// the read after it, and it can be silenced (every request held unanswered).
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ContentStub {
  /** The base URL: requests go to `${url}/data/database/version`. */
  url: string;
  /** Every request's path, in order. */
  requests: string[];
  /** The release answered; the fixture's, 98, at the start. */
  release: number;
  /** Hold every request from now on unanswered. */
  silence(): void;
  /** The release back to 98, the silence ended and the requests forgotten. */
  reset(): void;
  close(): Promise<void>;
}

export async function startContentStub(): Promise<ContentStub> {
  const hanging = new Set<ServerResponse>();
  let silent = false;
  const stub: ContentStub = {
    url: '',
    requests: [],
    release: 98,
    silence() {
      silent = true;
    },
    reset() {
      silent = false;
      stub.release = 98;
      stub.requests.length = 0;
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    },
  };
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://stub').pathname;
    stub.requests.push(path);
    if (silent) {
      hanging.add(res);
      return;
    }
    if (path !== '/data/database/version') {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"code":404}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain;charset=UTF-8' }).end(String(stub.release));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  stub.url = `http://127.0.0.1:${String(port)}`;
  return stub;
}
