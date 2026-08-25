// Deterministic gates for the huge-document settle benchmark.
//
// Wall-clock settle numbers are hardware-sensitive and stay a manual comparison; what CI can
// hold still is the WORK a keystroke performs on the pinned 521-page fixture. A change that
// re-places more paragraphs, reuses fewer pages, or triggers full passes on the huge document
// fails here — where a small synthetic fixture would hide it in the noise.

import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface Report {
  readonly fixtureSha256: string;
  readonly pages: number;
  readonly paragraphs: number;
  readonly work: {
    readonly placed: number;
    readonly total: number;
    readonly reusedPages: number;
    readonly fullPasses: number;
    readonly staleDiscards: number;
    readonly cancelledRuns: number;
  };
}

const root = resolve(import.meta.dir, '../..');
const fixture = resolve(root, 'e2e/fixtures/typing-perf-521pp.docx');

test('a keystroke on the huge document performs the pinned amount of work', () => {
  expect(existsSync(fixture)).toBe(true);
  const run = Bun.spawnSync({
    cmd: [
      process.execPath,
      'scripts/bench/settle-bench.ts',
      '--keystrokes',
      '2',
      '--warmup',
      '1',
      '--json',
    ],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  const report = JSON.parse(run.stdout.toString()) as Report;

  // Fixed measurer under happy-dom: pagination differs from the browser manifest count and
  // that is fine — what matters is that it never MOVES without a deliberate baseline update.
  expect(report.pages).toBe(561);
  expect(report.paragraphs).toBe(12820);
  expect(report.work).toEqual({
    // The last pass of a one-character keystroke: a handful of re-placed paragraphs against
    // the document's total, everything else reused. `fullPasses` counts the passes the OPEN
    // performs; typing must add none. The open's note-reserve reflow used to force a second
    // full pass because the document-wide reserve map was folded into every section's
    // context key; the key now folds only the reserve slots a section's own pass can read,
    // so the reflow's second body pass reuses every section and only the first pass is full.
    placed: 7,
    total: 6540,
    reusedPages: 555,
    fullPasses: 1,
    staleDiscards: 0,
    cancelledRuns: 0,
  });
}, 120_000);
