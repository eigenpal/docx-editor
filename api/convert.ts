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
 * the exporter resolves font files through `node:fs`; this function is that Node. It keeps the
 * same contract and the same limits as the local server: a 20 MiB upload, a 60 second
 * deadline, and no retention of the upload or the result after the response.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { exportPdf } from '@docx-editor.dev/docx-to-pdf';

const MAX_UPLOAD = 20 * 1024 * 1024;
const DEADLINE_MS = 60_000;

/** Time the function may hold the request; the exporter's own deadline is shorter. */
export const maxDuration = 90;
/** The body is the DOCX bytes; the platform must not parse it. */
export const config = { api: { bodyParser: false } };

function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
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
  if (origin && origin !== `https://${host}` && origin !== `http://${host}`)
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
  const bytes = await readBody(req);
  if (bytes === null) return json(res, 413, { message: 'Upload limit is 20 MiB.' });
  if (bytes.byteLength === 0) return json(res, 400, { message: 'Choose a DOCX file.' });
  try {
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
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    // The same shape the local demo server sends: a document the writer refuses is 422, a
    // document it cannot open is 400, a deadline is 408, and anything else is a 500.
    if (name === 'PdfFidelityError')
      return json(res, 422, {
        ok: false,
        error: name,
        message,
        diagnostics: (error as { diagnostics?: unknown }).diagnostics ?? [],
      });
    if (name === 'PdfDocumentOpenError') return json(res, 400, { ok: false, error: name, message });
    if (name === 'ExportResourceError' && /timed out/i.test(message))
      return json(res, 408, { ok: false, error: name, message });
    return json(res, 500, { ok: false, error: name, message: 'The conversion failed.' });
  }
}
