import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  assertBurstLatencyGates,
  assertCrossScenarioLatencyGates,
  assertScenarioLatencyGates,
  assertSustainedLatencyGates,
  HUGE_EXPECTED_LAYOUT_WORK,
  TRACKED_EXPECTED_LAYOUT_WORK,
} from './edit-browser-bench-gates.js';
import {
  EDIT_BROWSER_FIXTURE,
  EDIT_BROWSER_HUGE_FIXTURE,
  EDIT_BROWSER_TRACKED_FIXTURE,
  REPO_ROOT,
  REVIEW_RAIL_ENABLED,
  loadHarness,
  nonNegativeNumber,
  positiveInteger,
  summarize,
  summarizeOptional,
  twoFrames,
} from './edit-browser-bench-harness.js';
import {
  installMeasurementProbe,
  runEdit,
  runSustained,
  type ScenarioReport,
} from './edit-browser-bench-probe.js';
import { assertBurstDocumentState } from './edit-browser-burst-assertions.js';
import {
  BURST_DURATION_MS,
  BURST_RATE_HZ,
  type BurstReport,
  dispatchClipboard,
  runBurst,
} from './edit-browser-burst.js';

const FIXTURE_SHA256 = createHash('sha256')
  .update(readFileSync(resolve(REPO_ROOT, 'e2e/fixtures', EDIT_BROWSER_FIXTURE)))
  .digest('hex');
const RUNS = positiveInteger(process.env.EDIT_BROWSER_BENCH_RUNS, 7);
const WARMUP = positiveInteger(process.env.EDIT_BROWSER_BENCH_WARMUP, 2);
const SUSTAINED_EDITS = positiveInteger(process.env.EDIT_BROWSER_BENCH_SUSTAINED_EDITS, 180);
const SUSTAINED_WARMUP_EDITS = 20;
const INJECTED_DELAY_MS = nonNegativeNumber(process.env.EDIT_BROWSER_BENCH_DELAY_MS, 0);
const BURST_SCENARIO = process.env.EDIT_BROWSER_BENCH_BURST_SCENARIO;

const DEFAULT_BURST_SCENARIOS = [
  { name: 'editing-type', mode: 'edit' as const, input: 'type' as const },
  { name: 'editing-ordered-type', mode: 'edit' as const, input: 'ordered-type' as const },
  { name: 'editing-backspace', mode: 'edit' as const, input: 'backspace' as const },
  { name: 'editing-delete', mode: 'edit' as const, input: 'delete-forward' as const },
  { name: 'suggesting-type', mode: 'suggest' as const, input: 'type' as const },
  { name: 'suggesting-backspace', mode: 'suggest' as const, input: 'backspace' as const },
  { name: 'arrow-left', mode: 'edit' as const, input: 'arrow-left' as const },
  { name: 'arrow-right', mode: 'edit' as const, input: 'arrow-right' as const },
  { name: 'arrow-up', mode: 'edit' as const, input: 'arrow-up' as const },
  { name: 'arrow-down', mode: 'edit' as const, input: 'arrow-down' as const },
  { name: 'word-left', mode: 'edit' as const, input: 'word-left' as const },
  { name: 'line-start', mode: 'edit' as const, input: 'line-start' as const },
  { name: 'document-start', mode: 'edit' as const, input: 'document-start' as const },
] as const;

function collectRuntimeErrors(page: Page): string[] {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  return runtimeErrors;
}

function assertNoUnexpectedRuntimeErrors(runtimeErrors: readonly string[]): void {
  // Fail the browser benchmark on every page/console error. There are currently no
  // known-benign exclusions; add one here only with a concrete product reason.
  expect(runtimeErrors, 'unexpected page/console runtime errors').toEqual([]);
}

function isNavigationBurst(name: string): boolean {
  return (
    name.startsWith('arrow-') ||
    name === 'word-left' ||
    name === 'line-start' ||
    name === 'document-start'
  );
}

test('browser editing latency is measurable and structurally stable', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Event Timing and benchmark baselines use Chromium');
  // Three fixtures now run in one test (plain + tracked/numbered + the
  // ~1,000-page stress document); the default 180 s budget was sized for one.
  test.setTimeout(480_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await loadHarness(page, (benchPage) => installMeasurementProbe(benchPage, INJECTED_DELAY_MS));

  const scenarios = [
    { name: 'editing-character', mode: 'edit' as const, text: 'X' },
    { name: 'editing-wrap', mode: 'edit' as const, text: 'word '.repeat(20) },
    { name: 'suggesting-character', mode: 'suggest' as const, text: 'X' },
    { name: 'suggesting-wrap', mode: 'suggest' as const, text: 'word '.repeat(20) },
  ];
  const reports: ScenarioReport[] = [];

  async function measureScenario(scenario: {
    name: string;
    mode: 'edit' | 'suggest';
    text: string;
  }): Promise<ScenarioReport> {
    const samples = [];
    const selfTestBaselineSamples = [];
    for (let round = 0; round < WARMUP + RUNS; round += 1) {
      if (INJECTED_DELAY_MS > 0) {
        await page.evaluate(() => {
          window.__EDIT_BROWSER_BENCH__!.delayMs = 0;
        });
        const baselineSample = await runEdit(page, scenario.text, scenario.mode);
        if (round >= WARMUP) selfTestBaselineSamples.push(baselineSample);
        await page.evaluate((delayMs) => {
          window.__EDIT_BROWSER_BENCH__!.delayMs = delayMs;
        }, INJECTED_DELAY_MS);
      }
      const sample = await runEdit(page, scenario.text, scenario.mode);
      if (round >= WARMUP) samples.push(sample);
    }
    const signatures = new Set(
      samples.map(({ engine }) =>
        JSON.stringify({
          placed: engine.placed,
          total: engine.total,
          reusedPages: engine.reusedPages,
          fullPasses: engine.fullPasses,
          staleDiscards: engine.staleDiscards,
          cancelledRuns: engine.cancelledRuns,
        })
      )
    );
    expect(signatures.size).toBe(1);
    const engine = samples[0]!.engine;
    const inputTask = summarize(samples.map((sample) => sample.inputTaskMs));
    const baselineInputTask =
      selfTestBaselineSamples.length > 0
        ? summarize(selfTestBaselineSamples.map((sample) => sample.inputTaskMs))
        : null;
    const observedMedianDeltaMs =
      selfTestBaselineSamples.length > 0
        ? summarize(
            samples.map(
              (sample, index) => sample.inputTaskMs - selfTestBaselineSamples[index]!.inputTaskMs
            )
          ).medianMs
        : null;
    return {
      name: scenario.name,
      mode: scenario.mode,
      textLength: scenario.text.length,
      inputTask,
      frame: summarize(samples.map((sample) => sample.frameMs)),
      eventDuration: summarizeOptional(samples.map((sample) => sample.eventDurationMs)),
      eventDelay: summarizeOptional(samples.map((sample) => sample.eventDelayMs)),
      layout: summarize(samples.map((sample) => sample.engine.layoutMs)),
      paint: summarize(samples.map((sample) => sample.engine.paintMs)),
      selection: summarize(samples.map((sample) => sample.engine.selectionMs)),
      work: {
        placed: engine.placed,
        total: engine.total,
        reusedPages: engine.reusedPages,
        fullPasses: engine.fullPasses,
        staleDiscards: engine.staleDiscards,
        cancelledRuns: engine.cancelledRuns,
      },
      dom: {
        nodes: samples[0]!.domNodes,
        materializedPages: samples[0]!.materializedPages,
        selectionSpans: samples[0]!.selectionSpans,
      },
      ...(baselineInputTask && observedMedianDeltaMs !== null
        ? { selfTest: { baselineInputTask, observedMedianDeltaMs } }
        : {}),
    };
  }

  for (const scenario of scenarios) reports.push(await measureScenario(scenario));

  for (const report of reports) assertScenarioLatencyGates(report);
  assertCrossScenarioLatencyGates(reports);

  // ---- The tough companion pass: the same measurement over the tracked +
  // numbered fixture (~170+ pages of numbered clauses, ~310 dense tracked
  // replacements, review rail loaded). The plain fixture exercises pagination
  // breadth; this one exercises the paths that dominate real review documents —
  // list cascade, tracked-run structure, revision cards. Scenario names are
  // distinct so both sets share one report; work counters are pinned to this
  // fixture's own values. Skipped in the injected-delay self-test, which
  // validates the measurement itself, not the document.
  if (INJECTED_DELAY_MS === 0) {
    await loadHarness(
      page,
      (benchPage) => installMeasurementProbe(benchPage, 0),
      true,
      EDIT_BROWSER_TRACKED_FIXTURE
    );
    const trackedScenarios = [
      { name: 'tracked-editing-character', mode: 'edit' as const, text: 'X' },
      { name: 'tracked-suggesting-character', mode: 'suggest' as const, text: 'X' },
      { name: 'tracked-suggesting-wrap', mode: 'suggest' as const, text: 'word '.repeat(20) },
    ];
    for (const scenario of trackedScenarios) {
      const report = await measureScenario(scenario);
      reports.push(report);
      assertScenarioLatencyGates(report, TRACKED_EXPECTED_LAYOUT_WORK[scenario.name]!);
    }

    // ---- The stress pass: ~1,000 pages, ~1,060 tracked changes. The fixture
    // is deterministic but too large to commit, so it regenerates on demand.
    // Suggest mode only — the review workload is what documents this size are.
    execSync('bun scripts/create-synthetic-tracked-fixture.mjs --huge', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    await loadHarness(
      page,
      (benchPage) => installMeasurementProbe(benchPage, 0),
      true,
      EDIT_BROWSER_HUGE_FIXTURE
    );
    const hugeScenarios = [
      { name: 'huge-suggesting-character', mode: 'suggest' as const, text: 'X' },
      { name: 'huge-suggesting-wrap', mode: 'suggest' as const, text: 'word '.repeat(20) },
    ];
    for (const scenario of hugeScenarios) {
      const report = await measureScenario(scenario);
      reports.push(report);
      assertScenarioLatencyGates(report, HUGE_EXPECTED_LAYOUT_WORK[scenario.name]!);
    }
  }

  const sustained =
    INJECTED_DELAY_MS > 0
      ? []
      : [
          await runSustained(
            page,
            'edit',
            SUSTAINED_EDITS,
            SUSTAINED_WARMUP_EDITS,
            INJECTED_DELAY_MS
          ),
          await runSustained(
            page,
            'suggest',
            SUSTAINED_EDITS,
            SUSTAINED_WARMUP_EDITS,
            INJECTED_DELAY_MS
          ),
        ];
  for (const report of sustained) assertSustainedLatencyGates(report);

  const report = {
    schema: 1,
    fixture: EDIT_BROWSER_FIXTURE,
    fixtureSha256: FIXTURE_SHA256,
    environment: {
      browser: browserName,
      browserVersion: page.context().browser()?.version() ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
    },
    config: {
      runs: RUNS,
      warmup: WARMUP,
      sustainedEdits: SUSTAINED_EDITS,
      reviewRail: REVIEW_RAIL_ENABLED,
      viewport: '1440x1000@1x',
      injectedDelayMs: INJECTED_DELAY_MS,
    },
    scenarios: reports,
    sustained,
  };

  if (INJECTED_DELAY_MS > 0) {
    for (const scenario of reports) {
      expect(scenario.selfTest?.observedMedianDeltaMs).toBeGreaterThanOrEqual(
        INJECTED_DELAY_MS * 0.8
      );
    }
  }
  const serialized = JSON.stringify(report, null, 2);
  if (process.env.EDIT_BROWSER_BENCH_OUTPUT) {
    writeFileSync(process.env.EDIT_BROWSER_BENCH_OUTPUT, serialized);
  }
  console.log(`BROWSER_EDIT_BENCHMARK\n${serialized}`);
  assertNoUnexpectedRuntimeErrors(runtimeErrors);
});

test('copy and paste latency is measurable and text stays exact', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard event timing baseline uses Chromium');
  test.setTimeout(180_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await loadHarness(page, (benchPage) => installMeasurementProbe(benchPage, 0), false);

  for (const scenario of [
    { name: 'copy-paragraph', start: 0.5, end: 0.5 },
    { name: 'copy-multi-paragraph', start: 0.49, end: 0.51 },
  ]) {
    const prepared = await page.evaluate(
      ({ start, end }) => window.__DOCX_EDITOR_E2E__!.prepareClipboardBenchmark(start, end),
      scenario
    );
    expect(prepared?.pageCount).toBeGreaterThan(150);
    const samples: number[] = [];
    let copied = '';
    for (let index = 0; index < WARMUP + RUNS; index += 1) {
      const sample = await dispatchClipboard(page, 'copy');
      expect(sample.defaultPrevented).toBe(true);
      copied = sample.text;
      if (index >= WARMUP) samples.push(sample.taskMs);
    }
    expect(copied).toBe(prepared!.expectedText);
    console.log(`${scenario.name} copy median ${summarize(samples).medianMs} ms`);
  }

  for (const scenario of [
    { name: 'paste-small', text: '1234567890' },
    { name: 'paste-large', text: 'paste benchmark '.repeat(500) },
  ]) {
    const taskSamples: number[] = [];
    const frameSamples: number[] = [];
    for (let index = 0; index < WARMUP + RUNS; index += 1) {
      const prepared = await page.evaluate(() =>
        window.__DOCX_EDITOR_E2E__!.prepareEditBenchmark(0.5, 'edit', 0)
      );
      expect(prepared).not.toBeNull();
      const paragraphId = prepared!.paragraphId;
      const original = await page.evaluate(
        (id) => window.__DOCX_EDITOR_E2E__!.benchmarkParagraphText(id) ?? '',
        paragraphId
      );
      const sample = await dispatchClipboard(page, 'paste', scenario.text);
      expect(sample.defaultPrevented).toBe(true);
      const after = await page.evaluate(
        (id) => window.__DOCX_EDITOR_E2E__!.benchmarkParagraphText(id),
        paragraphId
      );
      expect(after).toBe(`${scenario.text}${original}`);
      if (index >= WARMUP) {
        taskSamples.push(sample.taskMs);
        frameSamples.push(sample.frameMs);
      }
      expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.undoBenchmarkEdit())).toBe(true);
      await twoFrames(page);
    }
    console.log(
      `${scenario.name} paste median task ${summarize(taskSamples).medianMs} ms, frame ${summarize(frameSamples).medianMs} ms`
    );
  }
  assertNoUnexpectedRuntimeErrors(runtimeErrors);
});

test('rapid input backlog and retained heap are measurable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP input scheduling and precise heap use Chromium');
  test.setTimeout(360_000);
  const runtimeErrors = collectRuntimeErrors(page);

  const availableScenarios =
    INJECTED_DELAY_MS > 0
      ? [{ name: 'editing-backspace', mode: 'edit' as const, input: 'backspace' as const }]
      : DEFAULT_BURST_SCENARIOS;
  const scenarios = BURST_SCENARIO
    ? availableScenarios.filter((scenario) => scenario.name === BURST_SCENARIO)
    : DEFAULT_BURST_SCENARIOS;
  if (scenarios.length === 0) throw new Error(`unknown burst scenario: ${BURST_SCENARIO}`);

  const reports: BurstReport[] = [];
  let selfTest:
    | {
        readonly baselineHandlerMedianMs: number;
        readonly delayedHandlerMedianMs: number;
        readonly observedMedianDeltaMs: number;
        readonly observedInjectedDelayMs: number;
      }
    | undefined;

  for (const scenario of scenarios) {
    if (INJECTED_DELAY_MS > 0) {
      const baseline = await runBurst(page, scenario);
      const delayed = await runBurst(page, scenario, INJECTED_DELAY_MS);
      const baselineMedian = baseline.handler?.medianMs ?? 0;
      const delayedMedian = delayed.handler?.medianMs ?? 0;
      selfTest = {
        baselineHandlerMedianMs: baselineMedian,
        delayedHandlerMedianMs: delayedMedian,
        observedMedianDeltaMs: delayedMedian - baselineMedian,
        observedInjectedDelayMs: delayed.injectedDelayObserved?.medianMs ?? 0,
      };
      reports.push(delayed);
    } else {
      reports.push(await runBurst(page, scenario));
    }
  }

  for (const report of reports) {
    expect(report.processedEvents).toBe(report.requestedEvents);
    expect(report.materializedPages).toBeLessThanOrEqual(8);
    expect(report.completionLatency.maxMs).toBeGreaterThan(0);
    if (isNavigationBurst(report.name)) {
      expect(report.finalSelection?.head).not.toEqual(report.initialSelection);
    }
    assertBurstDocumentState(report);
    if (INJECTED_DELAY_MS === 0) assertBurstLatencyGates(report);
  }
  if (selfTest) {
    expect(selfTest.observedInjectedDelayMs).toBeGreaterThanOrEqual(INJECTED_DELAY_MS * 0.8);
    expect(selfTest.observedMedianDeltaMs).toBeGreaterThanOrEqual(INJECTED_DELAY_MS * 0.8);
  }

  const report = {
    schema: 1,
    fixture: EDIT_BROWSER_FIXTURE,
    fixtureSha256: FIXTURE_SHA256,
    environment: {
      browser: browserName,
      browserVersion: page.context().browser()?.version() ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
    },
    config: {
      durationMs: BURST_DURATION_MS,
      rateHz: BURST_RATE_HZ,
      injectedDelayMs: INJECTED_DELAY_MS,
      reviewRail: REVIEW_RAIL_ENABLED,
      scenario: BURST_SCENARIO ?? 'all',
      viewport: '1440x1000@1x',
    },
    scenarios: reports,
    runtimeErrors,
    ...(selfTest ? { selfTest } : {}),
  };
  const serialized = JSON.stringify(report, null, 2);
  if (process.env.EDIT_BROWSER_BURST_OUTPUT) {
    writeFileSync(process.env.EDIT_BROWSER_BURST_OUTPUT, serialized);
  }
  console.log(`BROWSER_EDIT_BURST_BENCHMARK\n${serialized}`);
  assertNoUnexpectedRuntimeErrors(runtimeErrors);
});
