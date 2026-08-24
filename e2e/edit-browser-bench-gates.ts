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

/**
 * Pinned per scenario for the 521-page reported reproduction (typing-perf-521pp.docx).
 * Bootstrapped from a local Chromium run; a change means the engine performs different
 * work on the huge document, which is exactly what these exist to catch.
 */
export const PINNED_HUGE_EXPECTED_LAYOUT_WORK: Record<string, ExpectedLayoutWork> = {
  '521pp-editing-character': { placed: 11, total: 6540, reusedPages: 517, fullPasses: 2 },
  '521pp-editing-wrap': { placed: 11, total: 6540, reusedPages: 517, fullPasses: 2 },
  '521pp-suggesting-character': { placed: 11, total: 6540, reusedPages: 517, fullPasses: 2 },
};

/** Pinned for the ~1,000-page stress fixture (synthetic-huge-tracked.docx). */
export const HUGE_EXPECTED_LAYOUT_WORK: Record<string, ExpectedLayoutWork> = {
  'huge-suggesting-character': { placed: 2, total: 4250, reusedPages: 995, fullPasses: 1 },
  'huge-suggesting-wrap': { placed: 6, total: 4250, reusedPages: 994, fullPasses: 1 },
  // A 50k-character paste re-places 2,126 paragraphs and reflows half the
  // thousand pages — the standing tough case this fixture exists to watch.
  'huge-paste-50k': { placed: 2126, total: 4250, reusedPages: 497, fullPasses: 1 },
};

/** p95 may spike on loaded CI; 3× median plus 50 ms catches sustained regressions without pinning wall clock. */
const TIMING_P95_FACTOR = 3;
const TIMING_P95_FLOOR_MS = 50;

/**
 * `EDIT_BROWSER_BENCH_TIMING_TAILS=warn` downgrades the single-sample tail gates —
 * p95-vs-median and the sustained max-sample ceilings — to console warnings. On a
 * shared CI runner one scheduler stall is enough to trip them, and the CI benchmark
 * job treats wall clock as advisory. Everything median-based or structural (work
 * counters, median growth, heap, DOM size) stays a hard assertion in every mode.
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

/**
 * Sustained typing compares the first and last 10-sample windows: a median that
 * doubles over the run is the shape of an unbounded backlog.
 *
 * The ratio cannot carry the gate on its own. Outside a cross-origin-isolated page
 * Chromium clamps `performance.now()` to 100 µs, and what this measures — the
 * SYNCHRONOUS `beforeinput` handler, with nothing waiting on a frame inside it —
 * medians at 0.1 to 0.3 ms on CI, with 0.4 ms the worst single sample across 120
 * edits. On that grid one clock tick IS "+100%", which is where the runs that
 * failed pull requests with an exact `Received: 100` came from. A bigger window or
 * a mean would not fix it: every sample is already quantised to the same 0.1 ms,
 * and the median is the statistic that survives a scheduler stall on a shared
 * runner. The threshold is what was wrong, not the statistic.
 *
 * So each median gate pairs the ratio with an absolute floor — the same
 * `Math.max(ratio, floor)` shape as the tail gates above. Growth has to be a
 * doubling AND larger than anything the clock could have invented.
 */
const SUSTAINED_MEDIAN_GROWTH_FACTOR = 2;
/**
 * Ten clock ticks, and more than twice the worst single input-task sample CI has
 * produced. Quantisation cannot reach it; a handler whose cost grows with the
 * number of edits leaves it behind within a few dozen keystrokes.
 */
const SUSTAINED_INPUT_MEDIAN_FLOOR_MS = 1;
/**
 * Frame medians run 80-260 ms — two frames plus layout and paint — so the clock
 * grid is nowhere near them and this floor almost never binds. It keeps the two
 * median gates one shape, and covers a frame median that ever does get small.
 */
const SUSTAINED_FRAME_MEDIAN_FLOOR_MS = 16;
/**
 * The floor trades away sensitivity to small growth; this takes back the case that
 * matters, which no ratio can see at all: a regression already present in the FIRST
 * window reads as 0% growth forever. Half a frame of synchronous work per keystroke
 * is a typing regression whether or not it grew. 8 ms is 20× the worst single
 * sample observed, so it stays quiet until something is genuinely wrong — the same
 * bargain as the absolute burst-navigation median ceiling below.
 */
const SUSTAINED_INPUT_MEDIAN_CEILING_MS = 8;

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

  // Deliberately heavy scenarios exist to REPORT a large engine cost — a 50k
  // paste reflowing half a thousand-page document is the number, not a bug.
  // The keystroke-shaped ratio bound stays for everything else.
  if (!HEAVY_SCENARIOS.has(report.name)) {
    const engineMedian = report.layout.medianMs + report.paint.medianMs + report.selection.medianMs;
    expect(
      engineMedian,
      `${report.name} engine sub-steps vs inputTask median ${report.inputTask.medianMs} ms`
    ).toBeLessThanOrEqual(
      Math.max(report.inputTask.medianMs * ENGINE_TO_INPUT_FACTOR, ENGINE_TO_INPUT_FLOOR_MS)
    );
  }
}

/** Scenarios whose whole point is a large engine cost; the ratio bound above skips them. */
const HEAVY_SCENARIOS = new Set(['huge-paste-50k']);

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

/**
 * Reports the pair and the ceiling, never the bare percentage: `0.20 ms → 0.60 ms
 * (+200.0%), ceiling 1.20 ms` tells a human what moved, by how much, and what it
 * had to beat. A percentage of a tenth of a millisecond tells them nothing.
 */
function expectSustainedMedianGrowth(
  first: TimingSummary,
  last: TimingSummary,
  changePct: number,
  floorMs: number,
  label: string
): void {
  const ceilingMs = Math.max(
    first.medianMs * SUSTAINED_MEDIAN_GROWTH_FACTOR,
    first.medianMs + floorMs
  );
  const sign = changePct >= 0 ? '+' : '';
  expect(
    last.medianMs,
    `${label}: ${first.medianMs.toFixed(2)} ms → ${last.medianMs.toFixed(2)} ms ` +
      `(${sign}${changePct.toFixed(1)}%), ceiling ${ceilingMs.toFixed(2)} ms`
  ).toBeLessThanOrEqual(ceilingMs);
}

export function assertSustainedLatencyGates(sustained: SustainedReport): void {
  expectSustainedMedianGrowth(
    sustained.firstInputTask,
    sustained.lastInputTask,
    sustained.inputMedianChangePct,
    SUSTAINED_INPUT_MEDIAN_FLOOR_MS,
    `${sustained.mode} sustained input median`
  );
  expect(
    sustained.lastInputTask.medianMs,
    `${sustained.mode} sustained input median after ${sustained.edits} edits`
  ).toBeLessThanOrEqual(SUSTAINED_INPUT_MEDIAN_CEILING_MS);
  expectSustainedMedianGrowth(
    sustained.firstFrame,
    sustained.lastFrame,
    sustained.frameMedianChangePct,
    SUSTAINED_FRAME_MEDIAN_FLOOR_MS,
    `${sustained.mode} sustained frame median`
  );
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
    // An absolute byte delta, so the clock grid never reaches it — but it used to
    // fail as a bare nine-digit number with no label at all.
    expect(
      sustained.heapChangeBytes,
      `${sustained.mode} sustained heap growth after ${sustained.edits} edits ` +
        `(${(sustained.heapChangeBytes / 1024 / 1024).toFixed(1)} MiB)`
    ).toBeLessThan(SUSTAINED_HEAP_CEILING_BYTES);
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
