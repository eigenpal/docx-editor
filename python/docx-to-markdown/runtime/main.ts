// Bun entry for the docx-to-markdown Python package.
//
// `bun build --compile` turns this file into one executable per platform. The Python
// package spawns it once per conversion: one JSON request on stdin, one JSON response on
// stdout. Nothing here is public API; the Python module is the only caller.
//
// Two things keep the compiled binary self-contained:
// - `harfbuzz.wasm` is embedded with the `file` loader and must keep its original name
//   (`--asset-naming` in build.mjs), because the shaper reads it from beside the bundle.
// - The packaged fonts ship as plain files. Python points `DOCX_EDITOR_FONT_ASSET_ROOT`
//   at them before spawning, so the converter's bundled-font origin reads that directory.
import { readFile } from 'node:fs/promises';
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
  readonly docx: string;
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

function fail(code: string, message: string, detail?: unknown): never {
  process.stdout.write(
    JSON.stringify({ protocol: PROTOCOL_VERSION, error: { code, message, detail } })
  );
  process.exit(2);
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

async function readRequest(): Promise<ConversionRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('bad-request', 'stdin must hold one JSON request object');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    fail('bad-request', 'stdin must hold one JSON request object');
  const request = parsed as ConversionRequest;
  if (typeof request.docx !== 'string' || request.docx === '')
    fail('bad-request', '`docx` must be a file path');
  return request;
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

const request = await readRequest();
const { sources, errors: fontErrors } = await admitFonts(request.fonts ?? []);

let docxBytes: Uint8Array;
try {
  docxBytes = new Uint8Array(await readFile(request.docx));
} catch (cause) {
  fail(
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

try {
  const result = await exportMarkdown(docxBytes, options);
  const media = result.media.map((asset) => ({ id: asset.id, bytes: encodeBase64(asset.bytes) }));
  process.stdout.write(
    JSON.stringify({
      protocol: PROTOCOL_VERSION,
      result: toMarkdownJSON(result),
      mediaBytes: media,
      fontErrors,
    })
  );
} catch (cause) {
  const error = cause as { name?: string; code?: string; message?: string };
  fail(error.code ?? error.name ?? 'export-failed', error.message ?? String(cause));
}
