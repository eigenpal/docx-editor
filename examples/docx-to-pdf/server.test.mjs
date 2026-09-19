import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createPdfDemo } from './server.mjs';

test('Node worker converts a DOCX, rejects bad input, and recovers', async () => {
  const app = await createPdfDemo({ production: true });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const bytes = await readFile(new URL('./public/sample.docx', import.meta.url));
    const invalid = await fetch(`${base}/api/convert`, { method: 'POST', body: 'bad docx' });
    assert.equal(invalid.status, 400);
    await invalid.arrayBuffer();
    const result = await fetch(`${base}/api/convert`, { method: 'POST', body: bytes });
    assert.equal(result.status, 200);
    const json = await result.json();
    assert.ok(Buffer.from(json.pdf, 'base64').subarray(0, 5).equals(Buffer.from('%PDF-')));
    assert.equal(json.pageCount, 27);
    assert.deepEqual(json.diagnostics, []);
    assert.equal(
      (await fetch(`${base}/api/convert?fidelityPolicy=invalid`, { method: 'POST', body: bytes }))
        .status,
      400
    );
    assert.equal(
      (
        await fetch(`${base}/api/convert`, {
          method: 'POST',
          body: bytes,
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
      403
    );
    assert.equal((await fetch(`${base}/sample.docx`)).status, 200);
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
    const first = fetch(`${base}/api/convert`, {
      method: 'POST',
      body: 'test',
      signal: abort.signal,
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (await fetch(`${base}/api/convert`, { method: 'POST', body: 'test' })).status,
      503
    );
    abort.abort();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await fetch(`${base}/api/convert`, { method: 'POST', body: '' })).status, 400);
  } finally {
    abort.abort();
    await app.close();
  }
});
