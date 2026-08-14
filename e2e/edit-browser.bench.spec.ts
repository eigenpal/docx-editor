import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type BrowserSample,
  type EnginePerf,
  type TimingSummary,
  EDIT_BROWSER_FIXTURE,
  REPO_ROOT,
  heapBytes,
  loadHarness,
  nonNegativeNumber,
  percentChange,
  positiveInteger,
  summarize,
  summarizeOptional,
  twoFrames,
} from './edit-browser-bench-harness.js';
import { BURST_RATE_HZ, dispatchClipboard, runBurst } from './edit-browser-burst.js';

const FIXTURE_SHA256 = createHash('sha256')
  .update(readFileSync(resolve(REPO_ROOT, 'e2e/fixtures', EDIT_BROWSER_FIXTURE)))
  .digest('hex');
const RUNS = positiveInteger(process.env.EDIT_BROWSER_BENCH_RUNS, 7);
const WARMUP = positiveInteger(process.env.EDIT_BROWSER_BENCH_WARMUP, 2);
const SUSTAINED_EDITS = positiveInteger(process.env.EDIT_BROWSER_BENCH_SUSTAINED_EDITS, 180);
const SUSTAINED_WARMUP_EDITS = 20;
const INJECTED_DELAY_MS = nonNegativeNumber(process.env.EDIT_BROWSER_BENCH_DELAY_MS, 0);
const BURST_SCENARIO = process.env.EDIT_BROWSER_BENCH_BURST_SCENARIO;

interface EnginePerf {
  readonly layoutMs: number;
  readonly paintMs: number;
  readonly selectionMs: number;
  readonly placed: number;
  readonly total: number;
  readonly reusedPages: number;
  readonly fullPasses: number;
  readonly staleDiscards: number;
  readonly cancelledRuns: number;
}

interface BrowserSample {
  readonly inputTaskMs: number;
  readonly frameMs: number;
  readonly eventDurationMs: number | null;
  readonly eventDelayMs: number | null;
  readonly engine: EnginePerf;
  readonly domNodes: number;
  readonly materializedPages: number;
  readonly selectionSpans: number;
}

interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
}

interface ScenarioReport {
  readonly name: string;
  readonly mode: 'edit' | 'suggest';
  readonly textLength: number;
  readonly inputTask: TimingSummary;
  readonly frame: TimingSummary;
  readonly eventDuration: TimingSummary | null;
  readonly eventDelay: TimingSummary | null;
  readonly layout: TimingSummary;
  readonly paint: TimingSummary;
  readonly selection: TimingSummary;
  readonly work: Omit<EnginePerf, 'layoutMs' | 'paintMs' | 'selectionMs'>;
  readonly dom: {
    readonly nodes: number;
    readonly materializedPages: number;
    readonly selectionSpans: number;
  };
  readonly selfTest?: {
    readonly baselineInputTask: TimingSummary;
    readonly observedMedianDeltaMs: number;
  };
}

interface SustainedReport {
  readonly mode: 'edit' | 'suggest';
  readonly edits: number;
  readonly warmupEdits: number;
  readonly windowSize: number;
  readonly firstInputTask: TimingSummary;
  readonly lastInputTask: TimingSummary;
  readonly inputMedianChangePct: number;
  readonly firstFrame: TimingSummary;
  readonly lastFrame: TimingSummary;
  readonly frameMedianChangePct: number;
  readonly maxInputTaskMs: number;
  readonly maxFrameMs: number;
  readonly heapBeforeBytes: number | null;
  readonly heapAfterBytes: number | null;
  readonly heapChangeBytes: number | null;
}

declare global {
  interface Window {
    __EDIT_BROWSER_BENCH__?: {
      delayMs: number;
      samples: BrowserSample[];
      eventEntries: Array<{
        name: string;
        startTime: number;
        duration: number;
        processingStart: number;
      }>;
    };
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`expected positive integer: ${value}`);
  return parsed;
}

function nonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`expected non-negative number: ${value}`);
  return parsed;
}

function summarize(values: readonly number[]): TimingSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)]!,
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
  };
}

function summarizeOptional(values: readonly (number | null)[]): TimingSummary | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? summarize(present) : null;
}

async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

async function installMeasurementProbe(page: Page): Promise<void> {
  await page.evaluate((delayMs) => {
    const state = {
      delayMs,
      samples: [] as BrowserSample[],
      eventEntries: [] as Array<{
        name: string;
        startTime: number;
        duration: number;
        processingStart: number;
      }>,
    };
    window.__EDIT_BROWSER_BENCH__ = state;

    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('event')
    ) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEventTiming[]) {
          if (entry.name !== 'beforeinput' && entry.name !== 'input' && entry.name !== 'keydown') {
            continue;
          }
          state.eventEntries.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
            processingStart: entry.processingStart,
          });
        }
      });
      observer.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
    }

    let activeStart: number | null = null;
    document.addEventListener(
      'beforeinput',
      (event) => {
        if (!event.isTrusted) return;
        activeStart = performance.now();
        if (state.delayMs > 0) {
          const delayEnd = activeStart + state.delayMs;
          while (performance.now() < delayEnd) {
            // Intentional benchmark self-test delay.
          }
        }
      },
      { capture: true }
    );
    document.addEventListener('beforeinput', (event) => {
      if (!event.isTrusted || activeStart === null) return;
      const started = activeStart;
      activeStart = null;
      const inputTaskMs = performance.now() - started;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            const perf = window.__DOCX_EDITOR_E2E__?.benchmarkPerf();
            if (!perf) return;
            const eventEntry = [...state.eventEntries]
              .reverse()
              .find((entry) => entry.startTime >= started - 2);
            state.samples.push({
              inputTaskMs,
              frameMs: performance.now() - started,
              eventDurationMs: eventEntry?.duration ?? null,
              eventDelayMs: eventEntry ? eventEntry.processingStart - eventEntry.startTime : null,
              engine: perf,
              domNodes: document.querySelectorAll('.docx-pages *').length,
              materializedPages: document.querySelectorAll('.docx-page[data-materialized="true"]')
                .length,
              selectionSpans: document.querySelectorAll('[data-paragraph-id][data-start]').length,
            });
          }, 0);
        });
      });
    });
  }, INJECTED_DELAY_MS);
}

async function runEdit(page: Page, text: string, mode: 'edit' | 'suggest'): Promise<BrowserSample> {
  const prepared = await page.evaluate(
    ({ fraction, editingMode }) =>
      window.__DOCX_EDITOR_E2E__!.prepareEditBenchmark(fraction, editingMode),
    { fraction: 0.5, editingMode: mode }
  );
  expect(prepared).not.toBeNull();
  await twoFrames(page);

  const sampleCount = await page.evaluate(() => window.__EDIT_BROWSER_BENCH__!.samples.length);
  await page.keyboard.insertText(text);
  await page.waitForFunction(
    (before) => window.__EDIT_BROWSER_BENCH__!.samples.length > before,
    sampleCount
  );
  const sample = await page.evaluate(() => window.__EDIT_BROWSER_BENCH__!.samples.at(-1)!);
  expect(sample.engine.total).toBeGreaterThan(3_000);
  expect(sample.materializedPages).toBeLessThanOrEqual(8);
  expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.undoBenchmarkEdit())).toBe(true);
  await twoFrames(page);
  return sample;
}

async function runSustained(page: Page, mode: 'edit' | 'suggest'): Promise<SustainedReport> {
  await loadHarness(page, installMeasurementProbe);
  const prepared = await page.evaluate(
    ({ fraction, editingMode }) =>
      window.__DOCX_EDITOR_E2E__!.prepareEditBenchmark(fraction, editingMode),
    { fraction: 0.5, editingMode: mode }
  );
  expect(prepared).not.toBeNull();
  await twoFrames(page);
  for (let index = 0; index < SUSTAINED_WARMUP_EDITS; index += 1) {
    const sampleCount = await page.evaluate(() => window.__EDIT_BROWSER_BENCH__!.samples.length);
    await page.keyboard.insertText('X');
    await page.waitForFunction(
      (before) => window.__EDIT_BROWSER_BENCH__!.samples.length > before,
      sampleCount
    );
  }
  const heapBeforeBytes = await heapBytes(page);
  const samples: BrowserSample[] = [];
  for (let index = 0; index < SUSTAINED_EDITS; index += 1) {
    const sampleCount = await page.evaluate(() => window.__EDIT_BROWSER_BENCH__!.samples.length);
    await page.keyboard.insertText('X');
    await page.waitForFunction(
      (before) => window.__EDIT_BROWSER_BENCH__!.samples.length > before,
      sampleCount
    );
    samples.push(await page.evaluate(() => window.__EDIT_BROWSER_BENCH__!.samples.at(-1)!));
  }
  const heapAfterBytes = await heapBytes(page);
  const windowSize = Math.min(10, Math.max(1, Math.floor(samples.length / 3)));
  const first = samples.slice(0, windowSize);
  const last = samples.slice(-windowSize);
  const firstInputTask = summarize(first.map((sample) => sample.inputTaskMs));
  const lastInputTask = summarize(last.map((sample) => sample.inputTaskMs));
  const firstFrame = summarize(first.map((sample) => sample.frameMs));
  const lastFrame = summarize(last.map((sample) => sample.frameMs));
  return {
    mode,
    edits: samples.length,
    warmupEdits: SUSTAINED_WARMUP_EDITS,
    windowSize,
    firstInputTask,
    lastInputTask,
    inputMedianChangePct: percentChange(lastInputTask.medianMs, firstInputTask.medianMs),
    firstFrame,
    lastFrame,
    frameMedianChangePct: percentChange(lastFrame.medianMs, firstFrame.medianMs),
    maxInputTaskMs: Math.max(...samples.map((sample) => sample.inputTaskMs)),
    maxFrameMs: Math.max(...samples.map((sample) => sample.frameMs)),
    heapBeforeBytes,
    heapAfterBytes,
    heapChangeBytes:
      heapBeforeBytes === null || heapAfterBytes === null ? null : heapAfterBytes - heapBeforeBytes,
  };
}

test('browser editing latency is measurable and structurally stable', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Event Timing and benchmark baselines use Chromium');
  await loadHarness(page, installMeasurementProbe);

  const scenarios = [
    { name: 'editing-character', mode: 'edit' as const, text: 'X' },
    { name: 'editing-wrap', mode: 'edit' as const, text: 'word '.repeat(20) },
    { name: 'suggesting-character', mode: 'suggest' as const, text: 'X' },
    { name: 'suggesting-wrap', mode: 'suggest' as const, text: 'word '.repeat(20) },
  ];
  const reports: ScenarioReport[] = [];

  for (const scenario of scenarios) {
    const samples: BrowserSample[] = [];
    const selfTestBaselineSamples: BrowserSample[] = [];
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
    reports.push({
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
        ? {
            selfTest: {
              baselineInputTask,
              observedMedianDeltaMs,
            },
          }
        : {}),
    });
  }

  const sustained =
    INJECTED_DELAY_MS > 0
      ? []
      : [await runSustained(page, 'edit'), await runSustained(page, 'suggest')];
  const report = {
    schema: 1,
    fixture: FIXTURE,
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
});

test('copy and paste latency is measurable and text stays exact', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard event timing baseline uses Chromium');
  test.setTimeout(180_000);
  await loadHarness(page, installMeasurementProbe, false);
  const reports: {
    name: string;
    task: TimingSummary;
    frame: TimingSummary | null;
    textLength: number;
  }[] = [];

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
    reports.push({
      name: scenario.name,
      task: summarize(samples),
      frame: null,
      textLength: copied.length,
    });
  }

  for (const scenario of [
    { name: 'paste-small', text: '1234567890' },
    { name: 'paste-large', text: 'paste benchmark '.repeat(500) },
  ]) {
    const taskSamples: number[] = [];
    const frameSamples: number[] = [];
    let paragraphId = '';
    let original = '';
    for (let index = 0; index < WARMUP + RUNS; index += 1) {
      const prepared = await page.evaluate(() =>
        window.__DOCX_EDITOR_E2E__!.prepareEditBenchmark(0.5, 'edit', 0)
      );
      expect(prepared).not.toBeNull();
      paragraphId = prepared!.paragraphId;
      original = await page.evaluate(
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
    reports.push({
      name: scenario.name,
      task: summarize(taskSamples),
      frame: summarize(frameSamples),
      textLength: scenario.text.length,
    });
  }

  console.log(
    'BROWSER_CLIPBOARD_BENCHMARK\n' +
      JSON.stringify(
        {
          schema: 1,
          fixture: FIXTURE,
          config: { runs: RUNS, warmup: WARMUP, viewport: '1440x1000@1x' },
          scenarios: reports,
        },
        null,
        2
      )
  );
});

test('rapid input backlog and retained heap are measurable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP input scheduling and precise heap use Chromium');
  test.setTimeout(240_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  const availableScenarios =
    INJECTED_DELAY_MS > 0
      ? [{ name: 'editing-backspace', mode: 'edit' as const, input: 'backspace' as const }]
      : [
          { name: 'editing-type', mode: 'edit' as const, input: 'type' as const },
          {
            name: 'editing-ordered-type',
            mode: 'edit' as const,
            input: 'ordered-type' as const,
          },
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
        ];
  const scenarios = BURST_SCENARIO
    ? availableScenarios.filter((scenario) => scenario.name === BURST_SCENARIO)
    : availableScenarios.filter(
        (scenario) =>
          scenario.name !== 'arrow-up' &&
          scenario.name !== 'word-left' &&
          scenario.name !== 'line-start' &&
          scenario.name !== 'document-start'
      );
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
    if (
      report.name.startsWith('arrow-') ||
      report.name === 'word-left' ||
      report.name === 'line-start' ||
      report.name === 'document-start'
    ) {
      expect(report.finalSelection?.head).not.toEqual(report.initialSelection);
      // The pre-index path is about 40 ms median on this fixture and cannot keep up with
      // ordinary 30 Hz key repeat; the old vertical path was several seconds. Leave enough
      // CI headroom while still catching either whole-document shape.
      expect(report.handler?.medianMs).toBeLessThan(25);
    }
    if (report.name === 'editing-ordered-type') {
      const before = report.paragraphTextBefore!;
      const inserted = report.orderedText!;
      const start = report.initialSelection.offset;
      expect(report.paragraphTextAfter).toBe(
        `${before.slice(0, start)}${inserted}${before.slice(start)}`
      );
      expect(report.finalSelection?.head).toEqual({
        paragraphId: report.initialSelection.paragraphId,
        offset: start + inserted.length,
      });
    }
    if (report.name === 'editing-delete') {
      expect(report.paragraphTextAfter?.length).toBe(
        report.paragraphTextBefore!.length - report.requestedEvents
      );
    }
  }
  if (selfTest) {
    expect(selfTest.observedInjectedDelayMs).toBeGreaterThanOrEqual(INJECTED_DELAY_MS * 0.8);
  }

  const report = {
    schema: 1,
    fixture: FIXTURE,
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
  expect(runtimeErrors.filter((message) => message.includes('Maximum update depth'))).toEqual([]);
});
