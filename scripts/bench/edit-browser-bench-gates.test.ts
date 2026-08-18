import { describe, expect, test } from 'bun:test';
import { assertSustainedLatencyGates } from '../../e2e/edit-browser-bench-gates.js';
import { percentChange, type TimingSummary } from '../../e2e/edit-browser-bench-harness.js';
import { type SustainedReport } from '../../e2e/edit-browser-bench-probe.js';

/**
 * The sustained gates decide whether a pull request lands, from numbers a browser
 * produces in ten minutes. They are plain arithmetic over a report, so they run
 * here in milliseconds — feed the boundary values by hand and see which side of
 * the gate they fall on.
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
