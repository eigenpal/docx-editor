import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

interface Scenario {
  readonly name: string;
  readonly keystrokes: number;
  readonly staleDiscards: number;
  readonly cancelledRuns: number;
}

interface Report {
  readonly scenarios: readonly Scenario[];
}

/** Every scope the bench types into. A missing one is a silently narrowed gate. */
const EXPECTED_SCENARIOS = [
  'body-paragraph',
  'table-cell',
  'declared-header',
  'declared-footer',
  'declared-header-after-package-op',
  'created-header',
  'footnote',
];

const KEYSTROKES = 5;

test('typing wastes no layout passes, in any story', () => {
  const root = resolve(import.meta.dir, '../..');
  const run = Bun.spawnSync({
    cmd: [
      process.execPath,
      'scripts/bench/scope-waste-bench.ts',
      '--keystrokes',
      String(KEYSTROKES),
      '--json',
    ],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  expect(run.exitCode, run.stderr.toString()).toBe(0);
  const report = JSON.parse(run.stdout.toString()) as Report;
  expect(report.scenarios.map((scenario) => scenario.name)).toEqual(EXPECTED_SCENARIOS);

  // Zero, not a budget. A discarded pass is not merely wasted work: the surface keeps the
  // pre-edit paint, so the post-edit caret cannot be written into the nodes on screen and
  // the next repaint reads the stale one back. That is issue #361, and with the header
  // revision confusion in place these scenarios reported one discard per keystroke.
  expect(
    report.scenarios.map((scenario) => ({
      name: scenario.name,
      keystrokes: scenario.keystrokes,
      staleDiscards: scenario.staleDiscards,
      cancelledRuns: scenario.cancelledRuns,
    }))
  ).toEqual(
    EXPECTED_SCENARIOS.map((name) => ({
      name,
      keystrokes: KEYSTROKES,
      staleDiscards: 0,
      cancelledRuns: 0,
    }))
  );
}, 90_000);
