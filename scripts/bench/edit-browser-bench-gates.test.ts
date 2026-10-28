import { describe, expect, spyOn, test } from 'bun:test';
import {
  assertBurstLatencyGates,
  assertScenarioLatencyGates,
  assertSustainedLatencyGates,
} from '../../e2e/edit-browser-bench-gates.js';
import { percentChange, type TimingSummary } from '../../e2e/edit-browser-bench-harness.js';
import { type ScenarioReport, type SustainedReport } from '../../e2e/edit-browser-bench-probe.js';
import { type BurstReport } from '../../e2e/edit-browser-burst.js';

/**
 * The sustained and burst gates decide whether a pull request lands, from numbers a
 * browser produces in ten minutes. They are plain arithmetic over a report, so they run
 * here in milliseconds — feed the boundary values by hand and see which side of the
 * gate they fall on, in strict and in `EDIT_BROWSER_BENCH_TIMING_TAILS=warn` mode.
 *
 * Next to `edit-bench-gates.test.ts`, which does the same job for the headless
 * benchmark, and not next to the module it imports: `bun run test` walks
 * `packages/` and `scripts/`, so a test under `e2e/` would run on no machine but
 * the one it was written on.
 *
 * The numbers below are the ones CI actually reports: the input-task median is the
 * synchronous `beforeinput` handler on a clock clamped to 100 µs, so it lands on
 * 0.1, 0.2 or 0.3 ms, and the frame median lands near 100 ms.
 */
function summary(medianMs: number, p95Ms = medianMs): TimingSummary {
  return { medianMs, p95Ms, minMs: medianMs, maxMs: p95Ms };
}

function sustainedReport(overrides: {
  firstInputTaskMs: number;
  lastInputTaskMs: number;
  firstFrameMs?: number;
  lastFrameMs?: number;
}): SustainedReport {
  const firstInputTask = summary(overrides.firstInputTaskMs, overrides.firstInputTaskMs + 0.2);
  const lastInputTask = summary(overrides.lastInputTaskMs, overrides.lastInputTaskMs + 0.2);
  const firstFrame = summary(overrides.firstFrameMs ?? 100, (overrides.firstFrameMs ?? 100) + 40);
  const lastFrame = summary(overrides.lastFrameMs ?? 100, (overrides.lastFrameMs ?? 100) + 40);
  return {
    mode: 'edit',
    edits: 120,
    warmupEdits: 20,
    windowSize: 10,
    firstInputTask,
    lastInputTask,
    inputMedianChangePct: percentChange(lastInputTask.medianMs, firstInputTask.medianMs),
    firstFrame,
    lastFrame,
    frameMedianChangePct: percentChange(lastFrame.medianMs, firstFrame.medianMs),
    // Tails and heap sit well inside their own ceilings: these cases are about the
    // median gates and nothing else.
    maxInputTaskMs: lastInputTask.p95Ms,
    maxFrameMs: lastFrame.p95Ms,
    heapBeforeBytes: 100_000_000,
    heapAfterBytes: 100_000_000,
    heapChangeBytes: 0,
  };
}

describe('sustained input median gate', () => {
  test('passes the single clock tick that reads as an exact +100%', () => {
    // 0.1 -> 0.2 ms: one 100 µs tick, the failure that turned up three times on
    // two unrelated branches as `Expected: < 100 / Received: 100`.
    const report = sustainedReport({ firstInputTaskMs: 0.1, lastInputTaskMs: 0.2 });
    expect(report.inputMedianChangePct).toBe(100);
    expect(() => assertSustainedLatencyGates(report)).not.toThrow();
  });

  test('passes 99.9% and 200% growth while the medians stay sub-millisecond', () => {
    const justUnder = sustainedReport({ firstInputTaskMs: 0.1, lastInputTaskMs: 0.1999 });
    expect(justUnder.inputMedianChangePct).toBeCloseTo(99.9, 1);
    expect(() => assertSustainedLatencyGates(justUnder)).not.toThrow();

    // Two ticks on a 0.1 ms baseline. Nothing a user could feel, and nothing the
    // clock could not have produced on its own.
    const tripled = sustainedReport({ firstInputTaskMs: 0.1, lastInputTaskMs: 0.3 });
    expect(tripled.inputMedianChangePct).toBeCloseTo(200, 6);
    expect(() => assertSustainedLatencyGates(tripled)).not.toThrow();
  });

  test('fails growth past the absolute floor, however small the ratio', () => {
    // 0.2 -> 1.4 ms is only 7×, but it is 1.2 ms of real work the first window did
    // not do: past the floor, the doubling rule is back in charge.
    const report = sustainedReport({ firstInputTaskMs: 0.2, lastInputTaskMs: 1.4 });
    expect(() => assertSustainedLatencyGates(report)).toThrow(/sustained input median/);
  });

  test('fails a backlog that grows the handler into milliseconds', () => {
    const report = sustainedReport({ firstInputTaskMs: 0.2, lastInputTaskMs: 6 });
    expect(() => assertSustainedLatencyGates(report)).toThrow(/0\.20 ms → 6\.00 ms \(\+2900\.0%\)/);
  });

  test('holds the doubling rule once medians are large enough to mean it', () => {
    const doubled = sustainedReport({ firstInputTaskMs: 4, lastInputTaskMs: 8.1 });
    expect(() => assertSustainedLatencyGates(doubled)).toThrow(/sustained input median/);

    const grewLess = sustainedReport({ firstInputTaskMs: 4, lastInputTaskMs: 7.9 });
    expect(() => assertSustainedLatencyGates(grewLess)).not.toThrow();
  });

  test('fails a flat regression no ratio can see', () => {
    // 0% growth: the handler was already blocking for 9 ms in the first window.
    const report = sustainedReport({ firstInputTaskMs: 9, lastInputTaskMs: 9 });
    expect(report.inputMedianChangePct).toBe(0);
    expect(() => assertSustainedLatencyGates(report)).toThrow(
      /sustained input median after 120 edits/
    );
  });

  test('gates a window whose median rounds to zero instead of reporting 0%', () => {
    // `percentChange` returns 0 when the baseline is 0, so the old ratio was blind
    // here. The floor still holds the last window to 1 ms.
    const idle = sustainedReport({ firstInputTaskMs: 0, lastInputTaskMs: 0.3 });
    expect(idle.inputMedianChangePct).toBe(0);
    expect(() => assertSustainedLatencyGates(idle)).not.toThrow();

    const backlogged = sustainedReport({ firstInputTaskMs: 0, lastInputTaskMs: 3 });
    expect(() => assertSustainedLatencyGates(backlogged)).toThrow(/sustained input median/);
  });
});

describe('sustained frame median gate', () => {
  test('still fails a doubled frame median', () => {
    const report = sustainedReport({
      firstInputTaskMs: 0.2,
      lastInputTaskMs: 0.2,
      firstFrameMs: 100,
      lastFrameMs: 201,
    });
    expect(() => assertSustainedLatencyGates(report)).toThrow(
      /sustained frame median: 100\.00 ms → 201\.00 ms \(\+101\.0%\)/
    );
  });

  test('passes growth under the doubling', () => {
    const report = sustainedReport({
      firstInputTaskMs: 0.2,
      lastInputTaskMs: 0.2,
      firstFrameMs: 100,
      lastFrameMs: 190,
    });
    expect(() => assertSustainedLatencyGates(report)).not.toThrow();
  });

  test('absorbs the rounding on a frame median small enough for it to matter', () => {
    const report = sustainedReport({
      firstInputTaskMs: 0.2,
      lastInputTaskMs: 0.2,
      firstFrameMs: 8,
      lastFrameMs: 17,
    });
    expect(report.frameMedianChangePct).toBeGreaterThan(100);
    expect(() => assertSustainedLatencyGates(report)).not.toThrow();
  });
});

function burstReport(overrides: Partial<BurstReport> = {}): BurstReport {
  return {
    name: 'editing-type',
    mode: 'edit',
    requestedEvents: 1,
    processedEvents: 1,
    dispatchWindowMs: 1,
    drainMs: 0,
    completionLatency: summary(1),
    handler: summary(1),
    eventDelay: null,
    longTask: null,
    maxFrameGapMs: 1,
    heapBeforeBytes: null,
    heapAfterBytes: null,
    heapChangeBytes: null,
    peakObservedHeapBytes: null,
    domNodes: 1,
    materializedPages: 1,
    engine: {
      layoutMs: 0,
      paintMs: 0,
      selectionMs: 0,
      placed: 0,
      total: 0,
      reusedPages: 0,
      fullPasses: 0,
      staleDiscards: 0,
      cancelledRuns: 0,
    },
    initialSelection: { paragraphId: 'p', offset: 0 },
    finalSelection: null,
    orderedText: null,
    paragraphTextBefore: null,
    paragraphTextAfter: null,
    canUndo: false,
    revisionBefore: 0,
    revisionAfter: null,
    injectedDelayObserved: null,
    ...overrides,
  };
}

const scenarioReport: ScenarioReport = {
  name: 'editing-character',
  mode: 'edit',
  textLength: 1,
  inputTask: summary(1),
  frame: summary(1),
  eventDuration: null,
  eventDelay: null,
  layout: summary(1),
  paint: summary(1),
  selection: summary(1),
  work: {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    staleDiscards: 0,
    cancelledRuns: 0,
  },
  dom: { nodes: 1, materializedPages: 1, selectionSpans: 1 },
};

/** Run one gate in a timing-tail mode; the error it raised and the warnings it printed. */
function underMode(mode: 'strict' | 'warn', gate: () => void) {
  const previous = process.env.EDIT_BROWSER_BENCH_TIMING_TAILS;
  process.env.EDIT_BROWSER_BENCH_TIMING_TAILS = mode;
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    gate();
    return { error: null, warnings: warn.mock.calls.map((call) => String(call[0])) };
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure);
    return { error, warnings: warn.mock.calls.map((call) => String(call[0])) };
  } finally {
    warn.mockRestore();
    if (previous === undefined) delete process.env.EDIT_BROWSER_BENCH_TIMING_TAILS;
    else process.env.EDIT_BROWSER_BENCH_TIMING_TAILS = previous;
  }
}

const burst = (mode: 'strict' | 'warn', overrides: Partial<BurstReport> = {}) =>
  underMode(mode, () => assertBurstLatencyGates(burstReport(overrides)));
const passed = { error: null, warnings: [] };

describe('burst timing tails', () => {
  // Median 1 ms: the handler p95 ceiling is max(4 × 1, 1 + 40) = 41 ms, inclusive.
  const slowP95 = { handler: summary(1, 42) };
  const longGap = { maxFrameGapMs: 501 };

  test('warn mode reports handler p95 without failing the gate', () => {
    expect(burst('warn', slowP95)).toEqual({
      error: null,
      warnings: ['[timing-tail warn-only] editing-type handler p95: 42 ms exceeds 41 ms'],
    });
  });

  test('warn mode reports a frame gap without failing the gate', () => {
    expect(burst('warn', longGap)).toEqual({
      error: null,
      warnings: [
        '[timing-tail warn-only] editing-type max frame gap: 501 ms reaches or exceeds 500 ms',
      ],
    });
  });

  test('warn mode reports both exceeded tails', () => {
    expect(burst('warn', { ...slowP95, ...longGap }).warnings).toHaveLength(2);
  });

  test('strict mode rejects each exceeded tail', () => {
    const p95 = burst('strict', slowP95);
    expect(p95.error).toContain('handler p95');
    expect(p95.warnings).toEqual([]);
    const gap = burst('strict', longGap);
    expect(gap.error).toContain('max frame gap');
    expect(gap.warnings).toEqual([]);
  });

  test('the p95 ceiling stays inclusive in both modes', () => {
    expect(burst('strict', { handler: summary(1, 41) })).toEqual(passed);
    expect(burst('warn', { handler: summary(1, 41) })).toEqual(passed);
  });

  test('the frame gap ceiling stays exclusive', () => {
    expect(burst('strict', { maxFrameGapMs: 500 }).error).toContain('max frame gap');
    expect(burst('warn', { maxFrameGapMs: 500 })).toEqual({
      error: null,
      warnings: [
        '[timing-tail warn-only] editing-type max frame gap: 500 ms reaches or exceeds 500 ms',
      ],
    });
  });

  test('navigation median gates stay hard in both modes', () => {
    for (const mode of ['strict', 'warn'] as const) {
      const atCeiling = burst(mode, { name: 'arrow-left', handler: summary(25) });
      expect(atCeiling.error).toContain('handler median');
      expect(atCeiling.warnings).toEqual([]);
      expect(burst(mode, { name: 'arrow-left', handler: summary(24) })).toEqual(passed);
    }
  });

  test('work counter and DOM size gates stay hard in both modes', () => {
    for (const mode of ['strict', 'warn'] as const) {
      for (const report of [
        { ...scenarioReport, work: { ...scenarioReport.work, placed: 14 } },
        { ...scenarioReport, dom: { ...scenarioReport.dom, materializedPages: 9 } },
      ]) {
        const result = underMode(mode, () => assertScenarioLatencyGates(report));
        expect(result.error).not.toBeNull();
        expect(result.warnings).toEqual([]);
      }
    }
  });

  test('passing reports and absent handlers keep their behavior', () => {
    for (const mode of ['strict', 'warn'] as const) {
      expect(burst(mode)).toEqual(passed);
      expect(burst(mode, { handler: summary(100) })).toEqual(passed);
      expect(burst(mode, { handler: null, maxFrameGapMs: 501 })).toEqual(passed);
    }
  });
});
