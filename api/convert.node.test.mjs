/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The contract of the hosted conversion function, driven in-process with plain request and
// response stand-ins. The handler imports the built package, so this runs where `dist/`
// exists (the build lane) and skips itself elsewhere, like the demo server's test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { zipSync, strToU8 } from 'fflate';

const built = existsSync(new URL('../packages/docx-to-pdf/dist/index.js', import.meta.url));
const skip = built ? false : 'packages/docx-to-pdf is not built; run `bun run build:packages`';
const HOST = 'demo.example';

function request({ method = 'POST', url = '/api/convert', headers = {}, body } = {}) {
  const stream = body === undefined ? Readable.from([]) : Readable.from([Buffer.from(body)]);
  return Object.assign(stream, {
    method,
    url,
    headers: { host: HOST, ...headers },
  });
}

function response() {
  const out = { status: 0, headers: {}, body: '', destroyed: false, writableEnded: false };
  return {
    out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
      return this;
    },
    end(chunk) {
      out.body += chunk ?? '';
      out.writableEnded = true;
    },
  };
}

async function call(handler, options) {
  const res = response();
  await handler(request(options), res);
  return { status: res.out.status, json: res.out.body ? JSON.parse(res.out.body) : null };
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docx(body) {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

test(
  'the function refuses anything but a same-origin POST with valid options',
  { skip },
  async () => {
    const { default: handler } = await import('./convert.ts');
    const origin = { origin: `https://${HOST}` };
    assert.equal((await call(handler, { method: 'GET', headers: origin })).status, 405);
    assert.equal((await call(handler, { headers: {} })).status, 403);
    assert.equal(
      (await call(handler, { headers: { origin: 'https://elsewhere.example' } })).status,
      403
    );
    assert.equal(
      (await call(handler, { url: '/api/convert?fidelityPolicy=maybe', headers: origin })).status,
      400
    );
    assert.equal(
      (await call(handler, { headers: { ...origin, 'content-length': String(21 * 1024 * 1024) } }))
        .status,
      413
    );
    const empty = await call(handler, { headers: origin, body: Buffer.alloc(0) });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.message, 'Choose a DOCX file.');
  }
);

test('one conversion at a time per instance, then a PDF with diagnostics', { skip }, async () => {
  const { default: handler } = await import('./convert.ts');
  const origin = { origin: `https://${HOST}` };
  const sample = await readFile(new URL('../examples/vite/public/sample.docx', import.meta.url));
  const first = call(handler, { headers: origin, body: sample });
  // Arrives while the first request is still reading its body.
  const second = await call(handler, { headers: origin, body: sample });
  assert.equal(second.status, 503);
  const result = await first;
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.pageCount, 27);
  assert.ok(result.json.pdf.startsWith('JVBER'), 'base64 PDF');
  assert.ok(Array.isArray(result.json.diagnostics));
});

test(
  "failures answer with fixed text, never with the document's own details",
  { skip },
  async () => {
    const { default: handler } = await import('./convert.ts');
    const origin = { origin: `https://${HOST}` };
    const notDocx = await call(handler, { headers: origin, body: Buffer.from('not a zip at all') });
    assert.equal(notDocx.status, 400);
    assert.equal(notDocx.json.message, 'The file is not a DOCX this converter can open.');
    // A font the function cannot have: strict export refuses with the writer's diagnostics
    // behind a fixed message, the same shape the local demo server sends.
    const unknownFont = docx(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Sagona" w:hAnsi="Sagona"/></w:rPr><w:t>Text</w:t></w:r></w:p>'
    );
    const strict = await call(handler, { headers: origin, body: unknownFont });
    assert.equal(strict.status, 422);
    assert.equal(strict.json.error, 'PdfFidelityError');
    assert.equal(
      strict.json.message,
      'The document has content this converter cannot reproduce exactly.'
    );
    assert.equal(strict.json.diagnostics[0].code, 'font-substitution');
    const lenient = await call(handler, {
      url: '/api/convert?fidelityPolicy=best-effort',
      headers: origin,
      body: unknownFont,
    });
    assert.equal(lenient.status, 200);
    assert.equal(lenient.json.diagnostics[0].code, 'font-substitution');
  }
);

test('typed PDF limits retain the hosted resource-limit response', { skip }, async () => {
  const { pdfFailureResponse } = await import('./convert.ts');
  const { PdfPageLimitError, PdfOutputLimitError, PdfWorkLimitError } =
    await import('@docx-editor.dev/docx-to-pdf');
  for (const error of [
    new PdfPageLimitError(1, 2),
    new PdfOutputLimitError(1, 2),
    new PdfWorkLimitError(),
  ]) {
    const result = pdfFailureResponse(error);
    assert.equal(result.status, 507);
    assert.equal(result.body.error, error.name);
    assert.equal(
      result.body.message,
      'The document is larger than this demo converts. Convert a smaller document.'
    );
  }
});

test('hosted resource timeouts use the stable code instead of message text', { skip }, async () => {
  const { pdfFailureResponse } = await import('./convert.ts');
  const { ExportResourceError } = await import('@docx-editor.dev/docx-to-pdf');
  for (const message of ['Layout did not stabilize', 'Image decode did not settle']) {
    const result = pdfFailureResponse(new ExportResourceError('timedOut', message));
    assert.equal(result.status, 408);
    assert.equal(result.body.message, 'Conversion exceeded 60 seconds.');
  }
  assert.equal(pdfFailureResponse(new ExportResourceError('aborted', 'timed out')).status, 500);
});
