import { expect, test } from 'bun:test';
import { cache, ensureMassiveFixtures, runBench, workByName } from './edit-bench-gates-shared';

// The same content as ONE section with chapter-style page-break headings. An edit that
// adds a whole page (Ctrl+Enter) reconverges at the next authored page break, and the
// unchanged tail is reused by whole-sheet remap instead of being re-placed.
test('500-page single-section: whole-page shifts reuse the tail', () => {
  ensureMassiveFixtures();
  const report = runBench('e2e/fixtures/generated/synthetic-massive-singlesection.docx');
  expect(report.fixtureSha256).toBe(
    'dea67b65d100a30c203c87b4845163af8d955d59e06ee4f6f82c69eab11cb8db'
  );
  const work = workByName(report);
  expect(work['enter-split-middle']).toEqual({
    placed: 4,
    total: 8296,
    reusedPages: 629,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 630,
    cache: cache(422, 11972, 11972),
  });
  expect(work['backspace-join-middle']!.placed).toBe(2);
  expect(work['page-break-middle']).toEqual({
    placed: 3,
    total: 8295,
    reusedPages: 629,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 631,
    cache: cache(422, 11971, 11971),
  });
}, 240_000);
