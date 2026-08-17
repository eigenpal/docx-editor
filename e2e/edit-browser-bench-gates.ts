import { expect } from '@playwright/test';
import { type TimingSummary } from './edit-browser-bench-harness.js';
import { type ScenarioReport, type SustainedReport } from './edit-browser-bench-probe.js';
import { type BurstReport } from './edit-browser-burst.js';

/** Matches headless `bench:edit` steady-middle-text on the synthetic fixture. */
export const EXPECTED_LAYOUT_WORK = {
  placed: 13,
  total: 3200,
  reusedPages: 154,
  fullPasses: 1,
} as const;

export interface ExpectedLayoutWork {
  readonly placed: number;
  readonly total: number;
  readonly reusedPages: number;
  readonly fullPasses: number;
}

/**
 * Pinned per scenario for the tracked + numbered fixture
 * (synthetic-tracked-numbered.docx): its page geometry and edit shapes differ
 * from the plain fixture's, and a wrap insert places more paragraphs than a
 * single character.
 */
export const TRACKED_EXPECTED_LAYOUT_WORK: Record<string, ExpectedLayoutWork> = {
  'tracked-editing-character': { placed: 3, total: 620, reusedPages: 145, fullPasses: 1 },
  'tracked-suggesting-character': { placed: 3, total: 620, reusedPages: 145, fullPasses: 1 },
  // A 100-character tracked insert reflows roughly half the numbered clauses —
  // the going rate for a wrap in a dense review document, and exactly the load
  // this fixture exists to keep honest.
  'tracked-suggesting-wrap': { placed: 311, total: 620, reusedPages: 72, fullPasses: 1 },
};

/** Pinned for the ~1,000-page stress fixture (synthetic-huge-tracked.docx). */
export const HUGE_EXPECTED_LAYOUT_WORK: Record<string, ExpectedLayoutWork> = {
  'huge-suggesting-character': { placed: 2, total: 4250, reusedPages: 995, fullPasses: 1 },
  'huge-suggesting-wrap': { placed: 6, total: 4250, reusedPages: 994, fullPasses: 1 },
};

/** p95 may spike on loaded CI; 3× median plus 50 ms catches sustained regressions without pinning wall clock. */
const TIMING_P95_FACTOR = 3;
const TIMING_P95_FLOOR_MS = 50;

/**
 * `EDIT_BROWSER_BENCH_TIMING_TAILS=warn` downgrades the single-sample tail gates —
 * p95-vs-median and the sustained max-sample ceilings — to console warnings. On a
 * shared CI runner one scheduler stall is enough to trip them, and the CI benchmark
 * job treats wall clock as advisory. Everything median-based or structural (work
 * counters, growth percentages, heap, DOM size) stays a hard assertion in every mode.
 */
const TIMING_TAILS_WARN = process.env.EDIT_BROWSER_BENCH_TIMING_TAILS === 'warn';

function expectTailCeiling(actual: number, ceiling: number, label: string): void {
  if (TIMING_TAILS_WARN) {
    if (actual > ceiling) {
      console.warn(`[timing-tail warn-only] ${label}: ${actual} ms exceeds ${ceiling} ms`);
    }
    return;
  }
  expect(actual, label).toBeLessThanOrEqual(ceiling);
}

/** Engine layout/paint/selection combined should stay within 5× input-task median (generous for React/review rail). */
const ENGINE_TO_INPUT_FACTOR = 5;
const ENGINE_TO_INPUT_FLOOR_MS = 500;

/** Sustained typing compares first/last windows; 100% median growth flags unbounded backlog. */
const SUSTAINED_MEDIAN_GROWTH_PCT = 100;

/** Post-GC heap after 180 edits should stay below 50 MiB on the synthetic fixture. */
const SUSTAINED_HEAP_CEILING_BYTES = 50 * 1024 * 1024;

/** Burst handler medians for optimized navigation; old whole-document paths were seconds. */
const NAVIGATION_HANDLER_MEDIAN_CEILING_MS = 25;

/** Burst frame gaps; 500 ms catches multi-second stalls while tolerating two missed frames. */
const BURST_MAX_FRAME_GAP_MS = 500;

/** Burst handler p95 vs median; 4× catches tail regressions without absolute wall-clock gates. */
const BURST_HANDLER_P95_FACTOR = 4;
const BURST_HANDLER_P95_FLOOR_MS = 40;

function assertTimingTail(summary: TimingSummary, label: string): void {
  expectTailCeiling(
    summary.p95Ms,
    Math.max(summary.medianMs * TIMING_P95_FACTOR, summary.medianMs + TIMING_P95_FLOOR_MS),
    `${label} p95 (${summary.p95Ms} ms) vs median (${summary.medianMs} ms)`
  );
}

export function assertScenarioLatencyGates(
  report: ScenarioReport,
  expectedWork: ExpectedLayoutWork = EXPECTED_LAYOUT_WORK
): void {
  expect(report.work).toMatchObject(expectedWork);
  expect(report.work.staleDiscards).toBeGreaterThanOrEqual(0);
  expect(report.work.cancelledRuns).toBeGreaterThanOrEqual(0);
  expect(report.dom.materializedPages).toBeLessThanOrEqual(8);

  assertTimingTail(report.inputTask, `${report.name} inputTask`);
  assertTimingTail(report.frame, `${report.name} frame`);
  assertTimingTail(report.layout, `${report.name} layout`);
  assertTimingTail(report.paint, `${report.name} paint`);
  assertTimingTail(report.selection, `${report.name} selection`);

  const engineMedian = report.layout.medianMs + report.paint.medianMs + report.selection.medianMs;
  expect(
    engineMedian,
    `${report.name} engine sub-steps vs inputTask median ${report.inputTask.medianMs} ms`
  ).toBeLessThanOrEqual(
    Math.max(report.inputTask.medianMs * ENGINE_TO_INPUT_FACTOR, ENGINE_TO_INPUT_FLOOR_MS)
  );
}

export function assertCrossScenarioLatencyGates(reports: readonly ScenarioReport[]): void {
  const character = reports.find((report) => report.name === 'editing-character');
  const wrap = reports.find((report) => report.name === 'editing-wrap');
  if (character && wrap) {
    expect(
      wrap.inputTask.medianMs,
      'wrap input should stay within 6× single-character input on the same fixture'
    ).toBeLessThanOrEqual(
      Math.max(character.inputTask.medianMs * 6, character.inputTask.medianMs + 100)
    );
  }
}

export function assertSustainedLatencyGates(sustained: SustainedReport): void {
  expect(
    sustained.inputMedianChangePct,
    `${sustained.mode} sustained input median change`
  ).toBeLessThan(SUSTAINED_MEDIAN_GROWTH_PCT);
  expect(
    sustained.frameMedianChangePct,
    `${sustained.mode} sustained frame median change`
  ).toBeLessThan(SUSTAINED_MEDIAN_GROWTH_PCT);
  expectTailCeiling(
    sustained.maxInputTaskMs,
    Math.max(
      sustained.lastInputTask.p95Ms * TIMING_P95_FACTOR,
      sustained.lastInputTask.medianMs + 200
    ),
    `${sustained.mode} sustained max input task`
  );
  expectTailCeiling(
    sustained.maxFrameMs,
    Math.max(sustained.lastFrame.p95Ms * TIMING_P95_FACTOR, sustained.lastFrame.medianMs + 400),
    `${sustained.mode} sustained max frame`
  );
  if (sustained.heapChangeBytes !== null) {
    expect(sustained.heapChangeBytes).toBeLessThan(SUSTAINED_HEAP_CEILING_BYTES);
  }
}

function isNavigationBurst(name: string): boolean {
  return (
    name.startsWith('arrow-') ||
    name === 'word-left' ||
    name === 'line-start' ||
    name === 'document-start'
  );
}

export function assertBurstLatencyGates(report: BurstReport): void {
  if (!report.handler) return;
  if (isNavigationBurst(report.name)) {
    expect(report.handler.medianMs, `${report.name} handler median`).toBeLessThan(
      NAVIGATION_HANDLER_MEDIAN_CEILING_MS
    );
  }
  expect(report.handler.p95Ms, `${report.name} handler p95`).toBeLessThanOrEqual(
    Math.max(
      report.handler.medianMs * BURST_HANDLER_P95_FACTOR,
      report.handler.medianMs + BURST_HANDLER_P95_FLOOR_MS
    )
  );
  expect(report.maxFrameGapMs, `${report.name} max frame gap`).toBeLessThan(BURST_MAX_FRAME_GAP_MS);
}
