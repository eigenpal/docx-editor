/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  createPackagedFileFetch,
  openFontBackedDocumentForExport,
  type OpenFontBackedDocumentForExportOptions,
  type OpenFontBackedDocumentForExportResult,
} from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';
import { FONT_ASSET_ROOT, packagedFonts } from '@docx-editor.dev/fonts';
import {
  installedWordFonts,
  standInFonts,
  supplementalFonts,
  PDF_GLYPH_FALLBACKS,
} from './font-provisioning.ts';
import type { PdfExportOptions } from './types.ts';

const bundledFonts = packagedFonts({
  install: false,
  fetcher: createPackagedFileFetch({
    trustedRoot: new URL('./', FONT_ASSET_ROOT),
    maxBytes: HARD_MAX_FONT_BYTES,
  }),
});

/** The export options that shape the session, without the ones that shape the PDF. */
export type SessionOptions = Omit<
  PdfExportOptions,
  'comments' | 'fidelityPolicy' | 'timeoutMs' | 'maxOutputBytes' | 'maxPages'
>;

/**
 * Open a document the way `exportPdf` does: the same font origins in the same order, the
 * same fallback faces, the same display mode. The exporter and the development tools that
 * read layout records share this, so a tool sees exactly the layout the PDF is painted from.
 */
export function openExportSession(
  source: Uint8Array,
  options: SessionOptions,
  signal?: AbortSignal
): Promise<OpenFontBackedDocumentForExportResult> {
  const { fonts, fallbackFonts, lastResortFonts, useSystemFonts = true, ...core } = options;
  const origins: OpenFontBackedDocumentForExportOptions['fonts'] = [
    ...(fonts ? (Array.isArray(fonts) ? fonts : [fonts]) : []),
    ...(useSystemFonts ? [installedWordFonts] : []),
    bundledFonts,
    ...(fallbackFonts ? (Array.isArray(fallbackFonts) ? fallbackFonts : [fallbackFonts]) : []),
    supplementalFonts,
  ];
  return openFontBackedDocumentForExport(source, {
    ...core,
    documentLigatures: options.documentLigatures ?? true,
    signal,
    displayMode: options.displayMode ?? 'proposed',
    reuseAcrossRevisions: false,
    // Every packaged fallback face is on offer. They are read lazily, only when a family the
    // document uses needs one, so offering the whole list costs a plain Latin document nothing.
    glyphFallbacks: options.glyphFallbacks ?? PDF_GLYPH_FALLBACKS,
    fonts: origins,
    // After the document's own embedded fonts: a stand-in for what nothing else covers.
    lastResortFonts: [
      ...(lastResortFonts
        ? Array.isArray(lastResortFonts)
          ? lastResortFonts
          : [lastResortFonts]
        : []),
      standInFonts,
    ],
  });
}
