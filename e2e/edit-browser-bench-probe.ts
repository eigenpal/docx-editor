import { expect, type Page } from '@playwright/test';
import {
  type BrowserSample,
  type EnginePerf,
  type TimingSummary,
  heapBytes,
  loadHarness,
  percentChange,
  summarize,
  twoFrames,
} from './edit-browser-bench-harness.js';

export interface ScenarioReport {
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

export interface SustainedReport {
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

export async function installMeasurementProbe(page: Page, injectedDelayMs: number): Promise<void> {
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
  }, injectedDelayMs);
}

export async function runEdit(
  page: Page,
  text: string,
  mode: 'edit' | 'suggest'
): Promise<BrowserSample> {
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

export async function runSustained(
  page: Page,
  mode: 'edit' | 'suggest',
  sustainedEdits: number,
  warmupEdits: number,
  injectedDelayMs: number
): Promise<SustainedReport> {
  await loadHarness(page, (benchPage) => installMeasurementProbe(benchPage, injectedDelayMs));
  const prepared = await page.evaluate(
    ({ fraction, editingMode }) =>
      window.__DOCX_EDITOR_E2E__!.prepareEditBenchmark(fraction, editingMode),
    { fraction: 0.5, editingMode: mode }
  );
  expect(prepared).not.toBeNull();
  await twoFrames(page);
  for (let index = 0; index < warmupEdits; index += 1) {
    const sampleCount = await page.evaluate(() => window.__EDIT_BROWSER_BENCH__!.samples.length);
    await page.keyboard.insertText('X');
    await page.waitForFunction(
      (before) => window.__EDIT_BROWSER_BENCH__!.samples.length > before,
      sampleCount
    );
  }
  const heapBeforeBytes = await heapBytes(page);
  const samples: BrowserSample[] = [];
  for (let index = 0; index < sustainedEdits; index += 1) {
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
    warmupEdits,
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
