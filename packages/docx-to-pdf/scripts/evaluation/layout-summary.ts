/** Pagination-only evaluation through the same font-backed session as PDF export. */
import { readFile, writeFile } from 'node:fs/promises';
import { openExportSession } from '../../src/open-session.ts';

export async function summarizePages(source: Uint8Array) {
  const started = performance.now();
  const opened = await openExportSession(
    source,
    {
      displayMode: 'proposed',
      useSystemFonts: false,
      glyphFallbacks: [
        'Noto Sans Symbols 2',
        'Noto Sans Math',
        'Noto Sans Arabic',
        'Noto Sans CJK JP',
        'Twemoji Mozilla',
        'Noto Emoji',
      ].map((family) => ({ family, weight: 400, style: 'normal' as const })),
    },
    AbortSignal.timeout(60_000)
  );
  if (!opened.ok) throw new Error(`${opened.reason}: ${opened.detail ?? 'Document open failed'}`);
  try {
    const openMs = performance.now() - started;
    const layout = await opened.session.layout();
    if (!layout.pages.length || layout.pages.length > 1000)
      throw new Error('Layout exceeds page limit');
    return {
      protocol: 1,
      scope: 'layout-pagination',
      pageCount: layout.pages.length,
      pages: layout.pages.map((page) => ({ width: page.box.width, height: page.box.height })),
      fontResolution: opened.session.fontResolution,
      contentWarnings: layout.contentWarnings ?? [],
      timings: { openMs, layoutMs: performance.now() - started - openMs },
      textStatus: 'not-measured',
      visualStatus: 'not-measured',
    };
  } finally {
    opened.session.dispose();
  }
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  try {
    if (!input || !output) throw new Error('Expected input.docx output.json');
    const result = await summarizePages(new Uint8Array(await readFile(input)));
    await writeFile(output, JSON.stringify(result));
    console.log(JSON.stringify({ protocol: 1, status: 'laid-out', pages: result.pageCount }));
  } catch (error) {
    console.log(
      JSON.stringify({
        protocol: 1,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    process.exitCode = 1;
  }
}
