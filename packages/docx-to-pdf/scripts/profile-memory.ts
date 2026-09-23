/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Developer-only Bun phase profiler. Optional --collect observes retention after forced GC. */
import { heapStats } from 'bun:jsc';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import {
  createPackagedFileFetch,
  openFontBackedDocumentForExport,
} from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES } from '@docx-editor.dev/core/layout';
import { FONT_ASSET_ROOT, packagedFonts } from '@docx-editor.dev/fonts';
import {
  installedWordFonts,
  supplementalFonts,
  PDF_GLYPH_FALLBACKS,
} from '../src/font-provisioning.ts';
import { paint } from '../src/paint.ts';
import { Work } from '../src/context.ts';
const [input] = process.argv.slice(2);
if (!input) throw new Error('Usage: profile-memory.ts input.docx [--collect]');
const start = performance.now();
const record = (phase: string, extra: Record<string, unknown> = {}) => {
  const stats = heapStats();
  console.log(
    JSON.stringify({
      phase,
      elapsedMs: performance.now() - start,
      ...process.memoryUsage(),
      peakRssBytes: process.resourceUsage().maxRSS * (process.platform === 'darwin' ? 1 : 1024),
      jsc: {
        heapSize: stats.heapSize,
        heapCapacity: stats.heapCapacity,
        extraMemorySize: stats.extraMemorySize,
        objectCount: stats.objectCount,
        topTypes: Object.entries(stats.objectTypeCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8),
      },
      ...extra,
    })
  );
};
const collect = async (phase: string) => {
  if (!process.argv.includes('--collect')) return;
  Bun.gc(true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  Bun.gc(true);
  record(phase + '-after-gc');
};
record('start');
const bytes = new Uint8Array(await readFile(input));
const fonts = packagedFonts({
  install: false,
  fetcher: createPackagedFileFetch({
    trustedRoot: new URL('./', FONT_ASSET_ROOT),
    maxBytes: HARD_MAX_FONT_BYTES,
  }),
});
const opened = await openFontBackedDocumentForExport(bytes, {
  displayMode: 'proposed',
  reuseAcrossRevisions: false,
  glyphFallbacks: PDF_GLYPH_FALLBACKS,
  fonts: [installedWordFonts, fonts, supplementalFonts],
});
if (!opened.ok) throw new Error(opened.reason);
record('opened');
await collect('opened');
try {
  const layout = await opened.session.layout();
  record('layout', { pages: layout.pages.length });
  await collect('layout');
  const document = await PDFDocument.create({ updateMetadata: false });
  const work = new Work(new AbortController().signal);
  await paint(document, opened.session, layout, work, true);
  record('paint', { diagnostics: work.diagnostics });
  await collect('paint');
  const result = await document.save({ useObjectStreams: false, objectsPerTick: 50 });
  record('encoded', { outputBytes: result.length });
} finally {
  opened.session.dispose();
  record('disposed');
  await collect('disposed');
}
