/**
 * Server-first DOCX to Markdown conversion over the shared semantic layout engine.
 *
 * @packageDocumentation
 * @public
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  acquireSharedExportShaping,
  exportMarkdownFrom as translateMarkdown,
  openDocumentForExport as openCoreDocumentForExport,
  type ExportDocumentSource,
  type ExportSession,
  type MarkdownExportOptions,
  type MarkdownExportResult,
  type MarkdownTranslationOptions,
  type OpenDocumentForExportOptions,
  type OpenDocumentForExportResult,
} from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';
import { openHeadlessDocument } from '@docx-editor.dev/core/store';
import { loadDefaultFonts, type DefaultFontsFragment } from '@docx-editor.dev/fonts';
import { createRetryingLoader } from './retrying-loader.ts';

export { ExportResourceError } from '@docx-editor.dev/core/export';

export type {
  ExportDocumentSource,
  ExportSession,
  MarkdownExportOptions,
  MarkdownExportResult,
  MarkdownImageResult,
  MarkdownPage,
  MarkdownTranslationOptions,
  OpenDocumentForExportOptions,
  OpenDocumentForExportResult,
} from '@docx-editor.dev/core/export';

const packagedFileFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const value =
    input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (value.protocol !== 'file:') {
    throw new TypeError(`Packaged font URL must use file:, received ${value.protocol}`);
  }
  try {
    return new Response(await readFile(fileURLToPath(value)), { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

const defaultFonts = createRetryingLoader(async (): Promise<DefaultFontsFragment> => {
  const fragment = await loadDefaultFonts({ fetcher: packagedFileFetch });
  if (fragment.failures.length > 0 || fragment.sources.length === 0) {
    const detail = fragment.failures
      .map((failure) => `${failure.file}: ${failure.diagnostic}`)
      .join('; ');
    throw new Error(
      `Unable to provision packaged fonts for headless export${detail ? `: ${detail}` : ''}`
    );
  }
  return fragment;
});

function isByteSource(source: ExportDocumentSource): source is Uint8Array {
  return ArrayBuffer.isView(source);
}

/** Open a reusable export session with packaged fonts and HarfBuzz shaping by default. @public */
export async function openDocumentForExport(
  source: ExportDocumentSource,
  options: OpenDocumentForExportOptions = {}
): Promise<OpenDocumentForExportResult> {
  if (options.measurer) return openCoreDocumentForExport(source, options);
  // Reject attacker-controlled junk before loading or admitting any packaged font bytes.
  const prepared = isByteSource(source)
    ? openHeadlessDocument(source)
    : { ok: true as const, view: source };
  if (!prepared.ok) return prepared;
  const fragment = await defaultFonts();
  const configuration = {
    epoch: 1,
    maxFontBytes: HARD_MAX_FONT_BYTES,
    sources: fragment.sources,
    substitutions: fragment.substitutions,
    defaultFont: { family: 'Calibri', sizeHalfPoints: 22 },
  } as const;
  // The core cache is process-wide and multiple wrapper/fonts versions can share it. Include
  // every immutable configuration input, not only bytes, so request metadata and metric
  // substitutions can never alias across package versions.
  const configurationKey = JSON.stringify({
    epoch: configuration.epoch,
    maxFontBytes: configuration.maxFontBytes,
    sources: fragment.sources.map(({ bytes: _bytes, ...source }) => source),
    substitutions: fragment.substitutions,
    defaultFont: configuration.defaultFont,
  });
  const shared = await acquireSharedExportShaping({
    cacheKey: `@docx-editor.dev/fonts:${configurationKey}`,
    loadConfiguration: async () => configuration,
  });
  return openCoreDocumentForExport(prepared.view, {
    ...options,
    reuseAcrossRevisions: isByteSource(source) ? false : options.reuseAcrossRevisions,
    measurer: shared.createMeasurer(),
    producer: options.producer ?? shared.producer,
  });
}

/** Translate an existing shared export session without reopening or re-laying out it. @public */
export function exportMarkdownFrom(
  session: ExportSession,
  options: MarkdownTranslationOptions = {}
): Promise<MarkdownExportResult> {
  return translateMarkdown(session, options);
}

/** Convert untrusted DOCX bytes with Node-safe fonts, shaping, and image decoding defaults. @public */
export async function exportMarkdown(
  source: ExportDocumentSource,
  options: MarkdownExportOptions = {}
): Promise<MarkdownExportResult> {
  const opened = await openDocumentForExport(source, options);
  if (!opened.ok) {
    throw new Error(
      `Unable to open DOCX for export: ${opened.reason}${opened.detail ? ` (${opened.detail})` : ''}`
    );
  }
  try {
    return await translateMarkdown(opened.session, options.image ? { image: options.image } : {});
  } finally {
    opened.session.dispose();
  }
}
