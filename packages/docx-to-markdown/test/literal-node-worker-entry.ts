import { readFile } from 'node:fs/promises';

import { exportMarkdown, exportMarkdownFrom, openDocumentForExport } from '../src/index.ts';
import { canonicalLayout } from './canonical-layout.ts';

// Resident set size counts allocator and committed-page overhead that swings by more than 100 MiB
// across platforms for an identical live set, so it cannot carry a tight budget. The live heap
// after a forced full collection can: this export settles inside a 2% band across macOS arm64,
// Linux arm64 and Linux x64 for a given Node major, and the majors themselves sit 40 MiB apart at
// the widest. Collect repeatedly because one pass leaves objects that only become unreachable
// once the previous pass has finalized weak references.
function liveHeapBytes(): number {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (!collect) throw new Error('export test worker requires --expose-gc');
  for (let pass = 0; pass < 4; pass += 1) collect();
  return process.memoryUsage().heapUsed;
}

if (process.release.name !== 'node') throw new Error('export test worker requires Node');
const fixturePath = process.env.DOCX_EDITOR_WORKER_FIXTURE;
if (!fixturePath) throw new Error('DOCX_EDITOR_WORKER_FIXTURE is required');
const mode = process.env.DOCX_EDITOR_WORKER_MODE;
const fixture = await readFile(fixturePath);
if (mode === 'one-shot-performance') {
  const translated = await exportMarkdown(fixture);
  process.stdout.write(
    JSON.stringify({
      pages: translated.pages.length,
      sourceBytes: fixture.byteLength,
      markdownLength: translated.markdown.length,
      hasDom: typeof document !== 'undefined',
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      liveHeapBytes: liveHeapBytes(),
    })
  );
} else {
  const opened = await openDocumentForExport(
    fixture,
    mode === 'parity' ? { displayMode: 'all-markup' } : undefined
  );
  if (!opened.ok) throw new Error(`open refused: ${opened.reason}`);
  try {
    const layout = await opened.session.layout();
    if (mode === 'parity') {
      process.stdout.write(JSON.stringify(canonicalLayout(layout)));
    } else if (mode === 'performance') {
      const translated = await exportMarkdownFrom(opened.session);
      const countParagraphs = (
        blocks: readonly (typeof layout.pages)[number]['fragments'][number][]
      ): number =>
        blocks.reduce(
          (count, block) =>
            count +
            (block.kind === 'paragraph'
              ? 1
              : block.rows.reduce(
                  (rowCount, row) =>
                    rowCount +
                    row.cells.reduce(
                      (cellCount, cell) => cellCount + countParagraphs(cell.blocks),
                      0
                    ),
                  0
                )),
          0
        );
      process.stdout.write(
        JSON.stringify({
          pages: layout.pages.length,
          paragraphs: layout.pages.reduce(
            (count, page) => count + countParagraphs(page.fragments),
            0
          ),
          sourceBytes: fixture.byteLength,
          markdownLength: translated.markdown.length,
          hasDom: typeof document !== 'undefined',
          // Node reports maxRSS in KiB on every supported platform.
          peakRssBytes: process.resourceUsage().maxRSS * 1024,
          // Read before the `finally` disposes the session, so this is the set a caller retains
          // while it holds the settled layout.
          liveHeapBytes: liveHeapBytes(),
        })
      );
    } else {
      throw new Error(`unknown worker mode: ${mode ?? '(missing)'}`);
    }
  } finally {
    opened.session.dispose();
  }
}
