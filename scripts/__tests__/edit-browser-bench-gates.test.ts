import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { BurstReport } from '../../e2e/edit-browser-burst.js';
import type { ScenarioReport } from '../../e2e/edit-browser-bench-probe.js';

function burstReport(overrides: Partial<BurstReport> = {}): BurstReport {
  return {
    name: 'editing-type',
    mode: 'edit',
    requestedEvents: 1,
    processedEvents: 1,
    dispatchWindowMs: 1,
    drainMs: 0,
    completionLatency: { medianMs: 1, p95Ms: 1, minMs: 1, maxMs: 1 },
    handler: { medianMs: 1, p95Ms: 1, minMs: 1, maxMs: 1 },
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

const reports = {
  clean: burstReport(),
  p95: burstReport({ handler: { medianMs: 1, p95Ms: 42, minMs: 1, maxMs: 42 } }),
  frameGap: burstReport({ maxFrameGapMs: 501 }),
  bothTails: burstReport({
    handler: { medianMs: 1, p95Ms: 42, minMs: 1, maxMs: 42 },
    maxFrameGapMs: 501,
  }),
  p95AtCeiling: burstReport({ handler: { medianMs: 1, p95Ms: 41, minMs: 1, maxMs: 41 } }),
  frameGapAtCeiling: burstReport({ maxFrameGapMs: 500 }),
  navigationAtCeiling: burstReport({
    name: 'arrow-left',
    handler: { medianMs: 25, p95Ms: 25, minMs: 25, maxMs: 25 },
  }),
  navigationBelowCeiling: burstReport({
    name: 'arrow-left',
    handler: { medianMs: 24, p95Ms: 24, minMs: 24, maxMs: 24 },
  }),
  nonNavigationMedian: burstReport({
    handler: { medianMs: 100, p95Ms: 100, minMs: 100, maxMs: 100 },
  }),
  noHandler: burstReport({ handler: null, maxFrameGapMs: 501 }),
};

interface GateResult {
  readonly error: string | null;
  readonly warnings: readonly string[];
}

const scenario: ScenarioReport = {
  name: 'editing-character',
  mode: 'edit',
  textLength: 1,
  inputTask: { medianMs: 1, p95Ms: 1, minMs: 1, maxMs: 1 },
  frame: { medianMs: 1, p95Ms: 1, minMs: 1, maxMs: 1 },
  eventDuration: null,
  eventDelay: null,
  layout: { medianMs: 1, p95Ms: 1, minMs: 1, maxMs: 1 },
  paint: { medianMs: 1, p95Ms: 1, minMs: 1, maxMs: 1 },
  selection: { medianMs: 1, p95Ms: 1, minMs: 1, maxMs: 1 },
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

type GateResults = Record<keyof typeof reports | 'workCounter' | 'domSize', GateResult>;

function runGates(mode: 'strict' | 'warn'): GateResults {
  const gates = new URL('../../e2e/edit-browser-bench-gates.ts', import.meta.url);
  const script = `
    const { assertBurstLatencyGates, assertScenarioLatencyGates } = await import(${JSON.stringify(gates.href)});
    const reports = ${JSON.stringify(reports)};
    const results = {};
    for (const [name, report] of Object.entries(reports)) {
      const warnings = [];
      console.warn = (message) => warnings.push(message);
      let error = null;
      try { assertBurstLatencyGates(report); }
      catch (failure) { error = failure.message; }
      results[name] = { error, warnings };
    }
    const scenario = ${JSON.stringify(scenario)};
    for (const [name, report] of Object.entries({
      workCounter: { ...scenario, work: { ...scenario.work, placed: 14 } },
      domSize: { ...scenario, dom: { ...scenario.dom, materializedPages: 9 } },
    })) {
      const warnings = [];
      console.warn = (message) => warnings.push(message);
      let error = null;
      try { assertScenarioLatencyGates(report); }
      catch (failure) { error = failure.message; }
      results[name] = { error, warnings };
    }
    console.log(JSON.stringify(results));
  `;
  // The gate reads its mode at module load. Separate processes test both modes
  // without changing the test runner's environment or module cache.
  const child = spawnSync(process.execPath, ['--eval', script], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, EDIT_BROWSER_BENCH_TIMING_TAILS: mode },
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout);
}

describe('browser benchmark burst timing tails', () => {
  const strict = runGates('strict');
  const warn = runGates('warn');

  test('warn mode reports handler p95 without failing the gate', () => {
    expect(warn.p95.error).toBeNull();
    expect(warn.p95.warnings).toEqual([
      '[timing-tail warn-only] editing-type handler p95: 42 ms exceeds 41 ms',
    ]);
  });

  test('warn mode reports frame gaps without failing the gate', () => {
    expect(warn.frameGap.error).toBeNull();
    expect(warn.frameGap.warnings).toEqual([
      '[timing-tail warn-only] editing-type max frame gap: 501 ms reaches or exceeds 500 ms',
    ]);
  });

  test('warn mode reports both exceeded tails', () => {
    expect(warn.bothTails.error).toBeNull();
    expect(warn.bothTails.warnings).toHaveLength(2);
  });

  test('strict mode rejects each exceeded tail', () => {
    expect(strict.p95.error).toContain('handler p95');
    expect(strict.frameGap.error).toContain('max frame gap');
    expect(strict.p95.warnings).toEqual([]);
    expect(strict.frameGap.warnings).toEqual([]);
  });

  test('the p95 ceiling remains inclusive in both modes', () => {
    expect(strict.p95AtCeiling).toEqual({ error: null, warnings: [] });
    expect(warn.p95AtCeiling).toEqual({ error: null, warnings: [] });
  });

  test('the frame gap ceiling remains exclusive', () => {
    expect(strict.frameGapAtCeiling.error).toContain('max frame gap');
    expect(warn.frameGapAtCeiling.error).toBeNull();
    expect(warn.frameGapAtCeiling.warnings).toEqual([
      '[timing-tail warn-only] editing-type max frame gap: 500 ms reaches or exceeds 500 ms',
    ]);
  });

  test('navigation median gates remain hard in both modes', () => {
    expect(strict.navigationAtCeiling.error).toContain('handler median');
    expect(warn.navigationAtCeiling.error).toContain('handler median');
    expect(warn.navigationAtCeiling.warnings).toEqual([]);
    expect(strict.navigationBelowCeiling).toEqual({ error: null, warnings: [] });
    expect(warn.navigationBelowCeiling).toEqual({ error: null, warnings: [] });
  });

  test('work counter and DOM size gates remain hard in both modes', () => {
    for (const name of ['workCounter', 'domSize'] as const) {
      expect(strict[name].error).not.toBeNull();
      expect(warn[name].error).not.toBeNull();
      expect(warn[name].warnings).toEqual([]);
    }
  });

  test('passing reports and absent handlers keep their behavior', () => {
    for (const name of ['clean', 'nonNavigationMedian', 'noHandler'] as const) {
      expect(strict[name]).toEqual({ error: null, warnings: [] });
      expect(warn[name]).toEqual({ error: null, warnings: [] });
    }
  });
});
