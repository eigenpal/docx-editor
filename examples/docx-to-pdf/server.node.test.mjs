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
const skipUnbuilt = built
  ? false
  : 'packages/docx-to-pdf is not built; run `bun run build:packages`';

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

test(
  'Node worker converts a DOCX, rejects bad input, and recovers',
  { skip: skipUnbuilt },
  async () => {
    const app = await createPdfDemo({ production: true });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const base = `http://127.0.0.1:${app.server.address().port}`;
    try {
      const bytes = await readFile(new URL('../vite/public/sample.docx', import.meta.url));
      const invalid = await send(`${base}/api/convert`, { method: 'POST', body: 'bad docx' });
      assert.equal(invalid.status, 400);
      // A fixed message: the open error's own text names the zip entry that failed, which is
      // the upload's to choose, so it stays on the server.
      assert.equal(
        (await invalid.json()).message,
        'The file is not a DOCX this converter can open.'
      );
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
  }
);

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
    assert.equal((await send(`${base}/api/convert`, { method: 'POST', body: 'test' })).status, 503);
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

test('streaming reports worker startup, then generation, then a timed result', async () => {
  const workerUrl = new URL(
    'data:text/javascript,' +
      encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    setTimeout(() => {
      parentPort.postMessage({ type: 'ready' });
      setTimeout(() => parentPort.postMessage({
        ok: true, bytes: new Uint8Array([37, 80, 68, 70]), pageCount: 1,
        diagnostics: [], generationMs: 50,
      }), 50);
    }, 50);
  `)
  );
  const app = await createPdfDemo({ production: true, workerUrl });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  try {
    const response = await send(`http://127.0.0.1:${app.server.address().port}/api/convert`, {
      method: 'POST',
      body: 'test',
      headers: { Accept: 'application/x-ndjson' },
    });
    const events = (await response.arrayBuffer()).toString().trim().split('\n').map(JSON.parse);
    assert.equal(response.status, 200);
    assert.deepEqual(
      events.slice(0, 2).map(({ phase }) => phase),
      ['starting', 'generating']
    );
    assert.ok(events[1].workerStartupMs >= 50);
    assert.equal(events[2].type, 'result');
    assert.equal(events[2].status, 200);
    assert.equal(events[2].timings.workerStartupMs, events[1].workerStartupMs);
    assert.equal(events[2].timings.generationMs, 50);
    assert.equal(events[2].pdf, 'JVBERg==');
  } finally {
    await app.close();
  }
});

test('a streaming worker failure finishes with an error and frees the conversion slot', async () => {
  const app = await createPdfDemo({
    production: true,
    workerUrl: new URL('data:text/javascript,process.exit(1);'),
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}/api/convert`;
  try {
    const response = await send(url, {
      method: 'POST',
      body: 'test',
      headers: { Accept: 'application/x-ndjson' },
    });
    const events = (await response.arrayBuffer()).toString().trim().split('\n').map(JSON.parse);
    assert.equal(events[0].phase, 'starting');
    assert.equal(events[1].type, 'result');
    assert.equal(events[1].status, 500);
    assert.match(events[1].message, /failed/);
    assert.equal((await send(url, { method: 'POST', body: '' })).status, 400);
  } finally {
    await app.close();
  }
});

test(
  'a fidelity refusal answers with fixed text and the diagnostics, like the hosted function',
  {
    skip: skipUnbuilt,
  },
  async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const unknownFont = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Sagona" w:hAnsi="Sagona"/></w:rPr><w:t>Text</w:t></w:r></w:p></w:body></w:document>`
      ),
    });
    const app = await createPdfDemo({ production: true });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const base = `http://127.0.0.1:${app.server.address().port}`;
    try {
      const refused = await send(`${base}/api/convert`, { method: 'POST', body: unknownFont });
      assert.equal(refused.status, 422);
      const payload = await refused.json();
      assert.equal(payload.error, 'PdfFidelityError');
      assert.equal(
        payload.message,
        'The document has content this converter cannot reproduce exactly.'
      );
      assert.equal(payload.diagnostics[0].code, 'font-substitution');
    } finally {
      await app.close();
    }
  }
);
