import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createPdfDemo } from './server.mjs';

// The worker imports `@docx-editor.dev/docx-to-pdf`, which resolves to the package's `dist/`.
// Without a build the import fails inside the worker and every conversion answers 500, which
// says nothing about the server. The unit shards run without `build:packages`; the build lane
// runs this file after it. Skip here rather than fail there for the wrong reason.
const built = existsSync(new URL('../../packages/docx-to-pdf/dist/index.js', import.meta.url));
const skipUnbuilt = built ? false : 'packages/docx-to-pdf is not built; run `bun run build:packages`';

// `node:http`, not `fetch`. The repository test runner preloads happy-dom into every test
// process (see `bunfig.toml`), and happy-dom's `fetch` applies the same-origin policy to a
// document whose URL is `about:blank`, so every request to the loopback server under test is
// refused before it is sent. This file drives a real HTTP server; it needs a real client.
function send(url, { method = 'GET', body, headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req = httpRequest(
      url,
      {
        method,
        headers: payload ? { 'content-length': payload.byteLength, ...headers } : headers,
        signal,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            arrayBuffer: async () => buffer,
            json: async () => JSON.parse(buffer.toString('utf8')),
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('Node worker converts a DOCX, rejects bad input, and recovers', { skip: skipUnbuilt }, async () => {
  const app = await createPdfDemo({ production: true });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const bytes = await readFile(new URL('./public/sample.docx', import.meta.url));
    const invalid = await send(`${base}/api/convert`, { method: 'POST', body: 'bad docx' });
    assert.equal(invalid.status, 400);
    // A fixed message: the open error's own text names the zip entry that failed, which is
    // the upload's to choose, so it stays on the server.
    assert.equal((await invalid.json()).message, 'The file is not a DOCX this converter can open.');
    const result = await send(`${base}/api/convert`, { method: 'POST', body: bytes });
    assert.equal(result.status, 200);
    const json = await result.json();
    assert.ok(Buffer.from(json.pdf, 'base64').subarray(0, 5).equals(Buffer.from('%PDF-')));
    assert.equal(json.pageCount, 27);
    assert.deepEqual(json.diagnostics, []);
    assert.equal(
      (await send(`${base}/api/convert?fidelityPolicy=invalid`, { method: 'POST', body: bytes }))
        .status,
      400
    );
    assert.equal(
      (
        await send(`${base}/api/convert`, {
          method: 'POST',
          body: bytes,
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
      403
    );
    assert.equal((await send(`${base}/sample.docx`)).status, 200);
  } finally {
    await app.close();
  }
});

test('busy requests are refused and cancellation releases the worker slot', async () => {
  const workerUrl = new URL(
    'data:text/javascript,import {parentPort} from "node:worker_threads"; setTimeout(()=>parentPort.postMessage({ok:false,message:"late"}),60000);'
  );
  const app = await createPdfDemo({ production: true, workerUrl });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const abort = new AbortController();
  try {
    const first = send(`${base}/api/convert`, {
      method: 'POST',
      body: 'test',
      signal: abort.signal,
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (await send(`${base}/api/convert`, { method: 'POST', body: 'test' })).status,
      503
    );
    abort.abort();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await send(`${base}/api/convert`, { method: 'POST', body: '' })).status, 400);
  } finally {
    abort.abort();
    await app.close();
  }
});

// A worker that dies for any reason other than memory is a 500. Reporting every non-zero exit
// as 507 sent the operator to raise a heap limit for an import failure.
test('a worker that exits without a result is a 500, not "needs more memory"', async () => {
  const workerUrl = new URL('data:text/javascript,process.exit(1);');
  const app = await createPdfDemo({ production: true, workerUrl });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const response = await send(`${base}/api/convert`, { method: 'POST', body: 'test' });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.match(payload.message, /failed \(exit 1\)/);
    assert.doesNotMatch(payload.message, /memory/);
  } finally {
    await app.close();
  }
});

test('a conversion past the deadline is a 408 and releases the slot', async () => {
  const workerUrl = new URL(
    'data:text/javascript,import {parentPort} from "node:worker_threads"; setTimeout(()=>parentPort.postMessage({ok:false,message:"late"}),60000);'
  );
  const app = await createPdfDemo({ production: true, workerUrl, deadlineMs: 200 });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const late = await send(`${base}/api/convert`, { method: 'POST', body: 'test' });
    assert.equal(late.status, 408);
    assert.match((await late.json()).message, /exceeded 0 seconds|exceeded \d+ seconds/);
    // The slot is free again: an empty body is refused as 400, not 503.
    assert.equal((await send(`${base}/api/convert`, { method: 'POST', body: '' })).status, 400);
  } finally {
    await app.close();
  }
});
