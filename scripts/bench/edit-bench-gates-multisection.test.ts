import { expect, test } from 'bun:test';
import { cache, ensureMassiveFixtures, runBench, workByName } from './edit-bench-gates-shared';

// Ordinary row probes now provide placement records, so placement no longer repeats
// their paragraph-cache reads. Misses, retained entries, and page reuse stay unchanged.
//
// 500+ page, 105-section document — the repeated-copy shape a customer produces by pasting
// a template until the document is huge. The two structural keyboard edits must NOT reset
// the per-section sessions: before the multi-section fixes, Enter and Backspace placed all
// ~8.4k blocks (a full ~600ms relayout per keypress); they must stay at a handful.
test('500-page multi-section: Enter and Backspace stay incremental', () => {
  ensureMassiveFixtures();
  const report = runBench('e2e/fixtures/generated/synthetic-massive-multisection.docx');
  expect(report.fixtureSha256).toBe(
    '3462da9f2918283b2fa1a02494deb987823e8b118b62c65e7a69184a3b780e0e'
  );
  const work = workByName(report);
  expect(work['enter-split-middle']).toEqual({
    placed: 4,
    total: 8400,
    reusedPages: 624,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 630,
    cache: cache(422, 12076, 12076),
  });
  expect(work['backspace-join-middle']).toEqual({
    placed: 2,
    total: 8398,
    reusedPages: 624,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 630,
    cache: cache(421, 12075, 12075),
  });
  expect(work['enter-split-early']).toEqual({
    placed: 16,
    total: 8400,
    reusedPages: 624,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 630,
    cache: cache(434, 12076, 12076),
  });
  expect(work['steady-middle-text']!.placed).toBe(2);
  expect(work['wrap-middle-text']!.placed).toBe(41);
  // Adds one whole page; the pages below move but are reused, never re-placed.
  expect(work['page-break-middle']).toEqual({
    placed: 3,
    total: 8399,
    reusedPages: 372,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 631,
    cache: cache(422, 12075, 12075),
  });
}, 240_000);
