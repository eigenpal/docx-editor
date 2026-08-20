import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface Work {
  readonly placed: number;
  readonly total: number;
  readonly reusedPages: number;
  readonly fullPasses: number;
  readonly pagesBefore: number;
  readonly pagesAfter: number;
  readonly cache: {
    readonly hits: number;
    readonly misses: number;
    readonly evictions: number;
    readonly size: number;
  };
}

interface Report {
  readonly fixtureSha256: string;
  readonly scenarios: readonly { readonly name: string; readonly work: Work }[];
}

const root = resolve(import.meta.dir, '../..');

function runBench(fixture: string | null): Report {
  const run = Bun.spawnSync({
    cmd: [
      process.execPath,
      'scripts/bench/edit-bench.ts',
      ...(fixture ? [fixture] : []),
      '--runs',
      '1',
      '--warmup',
      '1',
      '--json',
    ],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  return JSON.parse(run.stdout.toString()) as Report;
}

function workByName(report: Report): Record<string, Work> {
  return Object.fromEntries(report.scenarios.map((scenario) => [scenario.name, scenario.work]));
}

const cache = (hits: number, misses: number, size: number) => ({
  hits,
  misses,
  evictions: 0,
  size,
});

// 200-page, 4-section committed fixture: every editing scenario — including the two
// structural keyboard edits, Enter and Backspace-join — stays bounded, and the break
// cache survives across passes (nonzero hits, zero evictions).
const EXPECTED_DEFAULT: Readonly<Record<string, Work>> = {
  'steady-middle-text': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(12, 3201, 3201),
  },
  'wrap-middle-text': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(12, 3201, 3201),
  },
  'forced-middle-reflow': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(12, 3201, 3201),
  },
  'forced-early-reflow': {
    placed: 13,
    total: 3200,
    reusedPages: 155,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(12, 3201, 3201),
  },
  'enter-split-middle': {
    placed: 13,
    total: 3201,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(11, 3202, 3202),
  },
  'backspace-join-middle': {
    placed: 11,
    total: 3199,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(10, 3201, 3201),
  },
  'enter-split-early': {
    placed: 14,
    total: 3201,
    reusedPages: 155,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: cache(12, 3202, 3202),
  },
  'page-break-middle': {
    placed: 12,
    total: 3200,
    reusedPages: 99,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 205,
    cache: cache(11, 3201, 3201),
  },
};

test('long-document edit work stays bounded', () => {
  const report = runBench(null);
  expect(report.fixtureSha256).toBe(
    'ca8ee28a8d40ae7914a820303b96ddbbe8f06d37325b0fc2ae6f1140aea96321'
  );
  expect(workByName(report)).toEqual(EXPECTED_DEFAULT);
}, 120_000);

// The 500+ page fixtures are generated on demand (they are too large to commit); the
// generator is byte-deterministic, so the sha still pins the content.
function ensureMassiveFixtures(): void {
  const multi = resolve(root, 'e2e/fixtures/generated/synthetic-massive-multisection.docx');
  const single = resolve(root, 'e2e/fixtures/generated/synthetic-massive-singlesection.docx');
  if (existsSync(multi) && existsSync(single)) return;
  const run = Bun.spawnSync({
    cmd: [process.execPath, 'scripts/create-synthetic-massive-edit-fixture.mjs'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
}

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
    placed: 5,
    total: 8400,
    reusedPages: 624,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 630,
    cache: cache(3855, 12076, 12076),
  });
  expect(work['backspace-join-middle']).toEqual({
    placed: 3,
    total: 8398,
    reusedPages: 624,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 630,
    cache: cache(3853, 12075, 12075),
  });
  expect(work['enter-split-early']).toEqual({
    placed: 16,
    total: 8400,
    reusedPages: 624,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 630,
    cache: cache(3794, 12076, 12076),
  });
  expect(work['steady-middle-text']!.placed).toBe(2);
  expect(work['wrap-middle-text']!.placed).toBe(41);
  // Adds one whole page; the pages below move but are reused, never re-placed.
  expect(work['page-break-middle']).toEqual({
    placed: 43,
    total: 8399,
    reusedPages: 312,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 631,
    cache: cache(3893, 12075, 12075),
  });
}, 240_000);

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
    placed: 5,
    total: 8296,
    reusedPages: 629,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 630,
    cache: cache(3855, 11972, 11972),
  });
  expect(work['backspace-join-middle']!.placed).toBe(3);
  expect(work['page-break-middle']).toEqual({
    placed: 43,
    total: 8295,
    reusedPages: 626,
    fullPasses: 1,
    pagesBefore: 630,
    pagesAfter: 631,
    cache: cache(3893, 11971, 11971),
  });
}, 240_000);
