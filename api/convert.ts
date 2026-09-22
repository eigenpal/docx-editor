/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `POST /api/convert` for the combined demo deployment.
 *
 * The DOCX to PDF demo at `/docx-to-pdf/` posts its document here, exactly as it posts to the
 * local demo server in `examples/docx-to-pdf/server.mjs`. The conversion runs in Node because
 * the exporter resolves font files through `node:fs`; this function is that Node.
 *
 * It keeps the local server's contract and its limits: a 20 MiB upload (the function's own
 * bound; the platform accepts larger bodies), a 60 second deadline,
 * one conversion at a time, and no retention of the upload or the result. Two things differ
 * because a function has no worker to hand the work to. The conversion runs in this process,
 * so its memory ceiling is the function's own, set in `vercel.json`; and "one at a time" is
 * per instance, a second request arriving while one runs is refused with 503 as the local
 * server does, so one instance never lays out two documents at once. The platform's own
 * concurrency limit bounds how many instances run; this function does not add a global lock. The request must carry
 * an `Origin` that matches the host: this endpoint exists for the demo page, and a browser
 * always sends `Origin` on a `POST`, so a request without one is not the page.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { exportPdf } from '@docx-editor.dev/docx-to-pdf';

const MAX_UPLOAD = 20 * 1024 * 1024;
const DEADLINE_MS = 60_000;

/** Time the function may hold the request; the exporter's own deadline is shorter. */
export const maxDuration = 90;
/** The body is the DOCX bytes; the platform must not parse it. */
export const config = { api: { bodyParser: false } };

/** One conversion per instance. Fluid Compute reuses an instance, so this is real. */
let active = false;

function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.end(JSON.stringify({ type: 'result', status, ...(value as object) }) + '\n');
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = chunk as Buffer;
    length += bytes.length;
    if (length > MAX_UPLOAD) return null;
    chunks.push(bytes);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { message: 'Use POST.' });
  const host = req.headers.host ?? '';
  const origin = req.headers.origin;
  // Required, not merely checked when present: the demo page is the only client, and a
  // browser sends `Origin` on every `POST`. A request without it is not the page.
  if (!origin || (origin !== `https://${host}` && origin !== `http://${host}`))
    return json(res, 403, { message: 'Use the same-origin demo.' });
  const url = new URL(req.url ?? '/', `https://${host || 'localhost'}`);
  const displayMode = url.searchParams.get('displayMode') ?? 'proposed';
  const comments = url.searchParams.get('comments') ?? 'true';
  const fidelityPolicy = url.searchParams.get('fidelityPolicy') ?? 'strict';
  if (
    !['proposed', 'original', 'all-markup'].includes(displayMode) ||
    !['true', 'false'].includes(comments) ||
    !['strict', 'best-effort'].includes(fidelityPolicy)
  )
    return json(res, 400, { message: 'Invalid conversion option.' });
  if (Number(req.headers['content-length']) > MAX_UPLOAD)
    return json(res, 413, { message: 'Upload limit is 20 MiB.' });
  if (active)
    return json(res, 503, { message: 'A conversion is already running. Retry when it finishes.' });
  active = true;
  try {
    const bytes = await readBody(req);
    if (bytes === null) return json(res, 413, { message: 'Upload limit is 20 MiB.' });
    if (bytes.byteLength === 0) return json(res, 400, { message: 'Choose a DOCX file.' });
    // This host converts in-process, so it reports generation without inventing a worker phase.
    if (req.headers.accept?.includes('application/x-ndjson')) {
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write(JSON.stringify({ type: 'progress', phase: 'generating' }) + '\n');
    }
    const generationStarted = performance.now();
    const result = await exportPdf(bytes, {
      displayMode: displayMode as 'proposed' | 'original' | 'all-markup',
      comments: comments === 'true',
      fidelityPolicy: fidelityPolicy as 'strict' | 'best-effort',
      timeoutMs: DEADLINE_MS,
      // The platform has no installed Word fonts; the packaged faces are the whole set here.
      useSystemFonts: false,
    });
    return json(res, 200, {
      ok: true,
      pdf: Buffer.from(result.bytes).toString('base64'),
      pageCount: result.pageCount,
      diagnostics: result.diagnostics,
      timings: { generationMs: performance.now() - generationStarted },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : '';
    // The same shape the local demo server sends. Every message here is fixed text: an open
    // failure's own message names the zip entry that failed, which is the upload's to choose,
    // and the diagnostics are the writer's own codes and wording.
    if (name === 'PdfFidelityError')
      return json(res, 422, {
        ok: false,
        error: name,
        message: 'The document has content this converter cannot reproduce exactly.',
        diagnostics: (error as { diagnostics?: unknown }).diagnostics ?? [],
      });
    if (name === 'PdfDocumentOpenError')
      return json(res, 400, {
        ok: false,
        error: name,
        message: 'The file is not a DOCX this converter can open.',
      });
    if (name === 'ExportResourceError' && /timed out/i.test(message))
      return json(res, 408, { ok: false, error: name, message: 'Conversion exceeded 60 seconds.' });
    if (name === 'RangeError' || name === 'PdfWorkLimitError')
      return json(res, 507, {
        ok: false,
        error: name,
        message: 'The document is larger than this demo converts. Convert a smaller document.',
      });
    return json(res, 500, { ok: false, error: name, message: 'The conversion failed.' });
  } finally {
    active = false;
  }
}
