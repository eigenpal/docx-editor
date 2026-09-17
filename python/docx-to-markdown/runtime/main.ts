// Bun entry for the docx-to-markdown Python package.
//
// `bun build --compile` turns this file into one executable per platform. The Python
// package drives it over JSON: one request on stdin and one response on stdout by
// default, or one request per line with `--serve`, which keeps the process and its
// shaper warm across many conversions. Nothing here is public API; the Python module is
// the only caller.
//
// Two things keep the compiled binary self-contained:
// - `harfbuzz.wasm` is embedded with the `file` loader and must keep its original name
//   (`--asset-naming` in build.mjs), because the shaper reads it from beside the bundle.
// - The packaged fonts ship as plain files. Python points `DOCX_EDITOR_FONT_ASSET_ROOT`
//   at them before spawning, so the converter's bundled-font origin reads that directory.
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import '@docx-editor.dev/core/harfbuzz.wasm' with { type: 'file' };
import {
  createFontSource,
  exportMarkdown,
  toMarkdownJSON,
  type MarkdownExportOptions,
  type MarkdownFontOrigin,
} from '@docx-editor.dev/docx-to-markdown';
import { googleFonts } from '@docx-editor.dev/fonts/google';

interface FontFaceRequest {
  readonly path: string;
  readonly family: string;
  readonly weight?: number;
  readonly style?: 'normal' | 'italic';
}

interface ConversionRequest {
  readonly op?: 'convert' | 'ping';
  readonly docx?: string;
  readonly fonts?: readonly FontFaceRequest[];
  readonly fontPolicy?: 'best-effort' | 'strict';
  readonly googleFonts?: boolean;
  readonly images?: boolean | { readonly syntax?: 'markdown' | 'html' };
  readonly displayMode?: 'all-markup' | 'proposed' | 'original';
}

interface FontFaceError {
  readonly path: string;
  readonly reason: string;
}

type AdmittedFontSource = Extract<
  ReturnType<typeof createFontSource>,
  { source: unknown }
>['source'];

const PROTOCOL_VERSION = 1;

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: unknown
  ) {
    super(message);
  }
}

function errorResponse(cause: unknown): object {
  if (cause instanceof RequestError)
    return {
      protocol: PROTOCOL_VERSION,
      error: { code: cause.code, message: cause.message, detail: cause.detail },
    };
  const error = cause as {
    name?: string;
    code?: string;
    reason?: string;
    detail?: string;
    message?: string;
  };
  if (error.name === 'DocumentOpenError') {
    // Stable code plus the engine's rejection reason, for callers that branch on it.
    return {
      protocol: PROTOCOL_VERSION,
      error: {
        code: 'invalid-docx',
        message: `Not a DOCX file this converter can open (${error.reason ?? 'unknown'})`,
        detail: { reason: error.reason, detail: error.detail },
      },
    };
  }
  return {
    protocol: PROTOCOL_VERSION,
    error: {
      code: error.code ?? error.name ?? 'export-failed',
      message: error.message ?? String(cause),
    },
  };
}

function parseRequest(text: string): ConversionRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestError('bad-request', 'each request must be one JSON object');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new RequestError('bad-request', 'each request must be one JSON object');
  return parsed as ConversionRequest;
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

async function admitFonts(
  faces: readonly FontFaceRequest[]
): Promise<{ sources: MarkdownFontOrigin[]; errors: FontFaceError[] }> {
  const sources: MarkdownFontOrigin[] = [];
  const errors: FontFaceError[] = [];
  const admitted: AdmittedFontSource[] = [];
  for (const face of faces) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(face.path));
    } catch (cause) {
      errors.push({
        path: face.path,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }
    const verdict = createFontSource(bytes, {
      family: face.family,
      weight: face.weight ?? 400,
      style: face.style ?? 'normal',
    });
    if ('failure' in verdict) {
      errors.push({
        path: face.path,
        reason: verdict.failure.diagnostic ?? verdict.failure.reason,
      });
      continue;
    }
    admitted.push(verdict.source);
  }
  if (admitted.length > 0) sources.push({ sources: admitted });
  return { sources, errors };
}

async function handle(request: ConversionRequest): Promise<object> {
  if (request.op === 'ping') return { protocol: PROTOCOL_VERSION, pong: true };
  if (typeof request.docx !== 'string' || request.docx === '')
    throw new RequestError('bad-request', '`docx` must be a file path');

  const { sources, errors: fontErrors } = await admitFonts(request.fonts ?? []);

  let docxBytes: Uint8Array;
  try {
    docxBytes = new Uint8Array(await readFile(request.docx));
  } catch (cause) {
    throw new RequestError(
      'docx-unreadable',
      `Could not read ${request.docx}`,
      cause instanceof Error ? cause.message : String(cause)
    );
  }

  const options: MarkdownExportOptions = {
    ...(sources.length > 0 ? { fonts: sources } : {}),
    ...(request.googleFonts ? { fallbackFonts: googleFonts() } : {}),
    ...(request.fontPolicy ? { fontPolicy: request.fontPolicy } : {}),
    ...(request.displayMode ? { displayMode: request.displayMode } : {}),
    images: request.images ?? false,
  };

  const result = await exportMarkdown(docxBytes, options);
  const mediaBytes = result.media.map((asset) => ({
    id: asset.id,
    bytes: encodeBase64(asset.bytes),
  }));
  return { protocol: PROTOCOL_VERSION, result: toMarkdownJSON(result), mediaBytes, fontErrors };
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function write(response: object, newline: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(JSON.stringify(response) + (newline ? '\n' : ''), (error) =>
      error ? reject(error) : resolve()
    );
  });
}

if (process.argv.includes('--serve')) {
  // One request per line, one response line each, in order. A failed request answers
  // with an error line and the server keeps running; EOF on stdin ends it.
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let response: object;
    try {
      response = await handle(parseRequest(line));
    } catch (cause) {
      response = errorResponse(cause);
    }
    await write(response, true);
  }
} else {
  try {
    await write(await handle(parseRequest(await readAllStdin())), false);
  } catch (cause) {
    await write(errorResponse(cause), false);
    process.exit(2);
  }
}
