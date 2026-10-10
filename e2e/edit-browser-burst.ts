import { expect, type Page } from '@playwright/test';
import { performance as nodePerformance } from 'node:perf_hooks';
import {
  type EnginePerf,
  type TimingSummary,
  delay,
  heapBytes,
  loadHarness,
  positiveInteger,
  summarize,
  twoFrames,
} from './edit-browser-bench-harness.js';

export const BURST_DURATION_MS = positiveInteger(process.env.EDIT_BROWSER_BENCH_BURST_MS, 5_000);
export const BURST_RATE_HZ = positiveInteger(process.env.EDIT_BROWSER_BENCH_BURST_HZ, 30);

export const BURST_NAVIGATION_DURATION_MS = positiveInteger(
  process.env.EDIT_BROWSER_BENCH_BURST_NAV_MS,
  2_000
);

export const BURST_ORDERED_DURATION_MS = positiveInteger(
  process.env.EDIT_BROWSER_BENCH_ORDERED_MS,
  100
);

export function burstDurationForScenario(name: string): number {
  if (name === 'editing-ordered-type') return BURST_ORDERED_DURATION_MS;
  if (
    name === 'editing-backspace' ||
    name === 'suggesting-backspace' ||
    name === 'arrow-up' ||
    name === 'word-left' ||
    name === 'line-start' ||
    name === 'document-start'
  ) {
    return BURST_NAVIGATION_DURATION_MS;
  }
  return BURST_DURATION_MS;
}

interface BurstProbeSnapshot {
  readonly keydowns: number;
  readonly beforeInputs: number;
  readonly handlerMs: readonly number[];
  readonly eventDelayMs: readonly number[];
  readonly longTasksMs: readonly number[];
  readonly frameGapsMs: readonly number[];
  readonly heapTimeline: readonly { atMs: number; usedBytes: number }[];
  readonly injectedDelayObservedMs: readonly number[];
}

export interface BurstReport {
  readonly name: string;
  readonly mode: 'edit' | 'suggest';
  readonly requestedEvents: number;
  readonly processedEvents: number;
  readonly dispatchWindowMs: number;
  readonly drainMs: number;
  readonly completionLatency: TimingSummary;
  readonly handler: TimingSummary | null;
  readonly eventDelay: TimingSummary | null;
  readonly longTask: TimingSummary | null;
  readonly maxFrameGapMs: number;
  readonly heapBeforeBytes: number | null;
  readonly heapAfterBytes: number | null;
  readonly heapChangeBytes: number | null;
  readonly peakObservedHeapBytes: number | null;
  readonly domNodes: number;
  readonly materializedPages: number;
  readonly engine: EnginePerf;
  readonly initialSelection: { readonly paragraphId: string; readonly offset: number };
  readonly finalSelection: {
    readonly anchor: { readonly paragraphId: string; readonly offset: number };
    readonly head: { readonly paragraphId: string; readonly offset: number };
  } | null;
  readonly orderedText: string | null;
  readonly paragraphTextBefore: string | null;
  readonly paragraphTextAfter: string | null;
  readonly canUndo: boolean;
  readonly revisionBefore: number;
  readonly revisionAfter: number | null;
  readonly injectedDelayObserved: TimingSummary | null;
}

export type BurstInput =
  | 'type'
  | 'ordered-type'
  | 'backspace'
  | 'delete-forward'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'word-left'
  | 'line-start'
  | 'document-start';

declare global {
  interface Window {
    __EDIT_BURST_BENCH__?: {
      stop(): BurstProbeSnapshot;
    };
  }
}

function burstNavigation(input: BurstInput):
  | {
      readonly key: string;
      readonly code: string;
      readonly windowsVirtualKeyCode: number;
      readonly nativeVirtualKeyCode: number;
      readonly modifiers?: number;
    }
  | undefined {
  if (input === 'arrow-left' || input === 'word-left') {
    return {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      windowsVirtualKeyCode: 37,
      nativeVirtualKeyCode: 123,
      ...(input === 'word-left' ? { modifiers: 1 } : {}),
    };
  }
  if (input === 'arrow-right') {
    return {
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 124,
    };
  }
  if (input === 'arrow-up') {
    return {
      key: 'ArrowUp',
      code: 'ArrowUp',
      windowsVirtualKeyCode: 38,
      nativeVirtualKeyCode: 126,
    };
  }
  if (input === 'arrow-down') {
    return {
      key: 'ArrowDown',
      code: 'ArrowDown',
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 125,
    };
  }
  if (input === 'line-start' || input === 'document-start') {
    return {
      key: 'Home',
      code: 'Home',
      windowsVirtualKeyCode: 36,
      nativeVirtualKeyCode: 115,
      ...(input === 'document-start' ? { modifiers: 4 } : {}),
    };
  }
  return undefined;
}

async function installBurstProbe(page: Page, injectedDelayMs = 0): Promise<void> {
  await page.evaluate((delayMs) => {
    const started = new WeakMap<Event, number>();
    const handlerMs: number[] = [];
    const eventDelayMs: number[] = [];
    const longTasksMs: number[] = [];
    const frameGapsMs: number[] = [];
    const heapTimeline: Array<{ atMs: number; usedBytes: number }> = [];
    const injectedDelayObservedMs: number[] = [];
    const installedAt = performance.now();
    let keydowns = 0;
    let beforeInputs = 0;
    let stopped = false;
    let previousFrame = installedAt;
    let previousHeapSample = 0;

    const begin = (event: Event): void => {
      if (!event.isTrusted) return;
      started.set(event, performance.now());
      if (event.type === 'keydown') keydowns += 1;
      else beforeInputs += 1;
      if (delayMs > 0) {
        const delayStart = performance.now();
        const delayEnd = performance.now() + delayMs;
        while (performance.now() < delayEnd) {
          // Intentional benchmark self-test delay.
        }
        injectedDelayObservedMs.push(performance.now() - delayStart);
      }
    };
    const end = (event: Event): void => {
      const start = started.get(event);
      if (start !== undefined) handlerMs.push(performance.now() - start);
    };
    document.addEventListener('keydown', begin, { capture: true });
    document.addEventListener('keydown', end);
    document.addEventListener('beforeinput', begin, { capture: true });
    document.addEventListener('beforeinput', end);

    const observers: PerformanceObserver[] = [];
    if (PerformanceObserver.supportedEntryTypes?.includes('event')) {
      const eventObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEventTiming[]) {
          if (entry.name === 'keydown' || entry.name === 'beforeinput') {
            eventDelayMs.push(entry.processingStart - entry.startTime);
          }
        }
      });
      eventObserver.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
      observers.push(eventObserver);
    }
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasksMs.push(entry.duration);
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      observers.push(longTaskObserver);
    }

    const sampleFrame = (now: number): void => {
      if (stopped) return;
      frameGapsMs.push(now - previousFrame);
      previousFrame = now;
      if (now - previousHeapSample >= 500) {
        const memory = (
          performance as Performance & {
            memory?: { readonly usedJSHeapSize: number };
          }
        ).memory;
        if (memory)
          heapTimeline.push({ atMs: now - installedAt, usedBytes: memory.usedJSHeapSize });
        previousHeapSample = now;
      }
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);

    window.__EDIT_BURST_BENCH__ = {
      stop() {
        stopped = true;
        for (const observer of observers) observer.disconnect();
        document.removeEventListener('keydown', begin, { capture: true });
        document.removeEventListener('keydown', end);
        document.removeEventListener('beforeinput', begin, { capture: true });
        document.removeEventListener('beforeinput', end);
        return {
          keydowns,
          beforeInputs,
          handlerMs,
          eventDelayMs,
          longTasksMs,
          frameGapsMs,
          heapTimeline,
          injectedDelayObservedMs,
        };
      },
    };
  }, injectedDelayMs);
}

export async function dispatchClipboard(
  page: Page,
  type: 'copy' | 'paste',
  text = ''
): Promise<{ taskMs: number; frameMs: number; text: string; defaultPrevented: boolean }> {
  return page.evaluate(
    async ({ eventType, payload }) => {
      const pages = document.querySelector<HTMLElement>('.docx-pages');
      if (!pages) throw new Error('pages layer missing');
      const transfer = new DataTransfer();
      if (eventType === 'paste') transfer.setData('text/plain', payload);
      const event = new ClipboardEvent(eventType, {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      });
      const began = performance.now();
      pages.dispatchEvent(event);
      const taskMs = performance.now() - began;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      return {
        taskMs,
        frameMs: performance.now() - began,
        text: transfer.getData('text/plain'),
        defaultPrevented: event.defaultPrevented,
      };
    },
    { eventType: type, payload: text }
  );
}

export async function runBurst(
  page: Page,
  scenario: {
    readonly name: string;
    readonly mode: 'edit' | 'suggest';
    readonly input: BurstInput;
  },
  injectedDelayMs = 0
): Promise<BurstReport> {
  await loadHarness(page, async () => {}, false);
  const prepared = await page.evaluate(
    ({ editingMode, offsetFraction }) =>
      window.__DOCX_EDITOR_E2E__!.prepareEditBenchmark(0.5, editingMode, offsetFraction),
    {
      editingMode: scenario.mode,
      offsetFraction: (() => {
        if (scenario.input === 'backspace') return 0.5;
        if (scenario.input === 'delete-forward') return 0;
        if (
          scenario.input === 'arrow-left' ||
          scenario.input === 'arrow-up' ||
          scenario.input === 'word-left' ||
          scenario.input === 'line-start' ||
          scenario.input === 'document-start'
        ) {
          return 1;
        }
        return 0;
      })(),
    }
  );
  expect(prepared).not.toBeNull();
  expect(prepared!.pageCount).toBeGreaterThan(150);
  const paragraphTextBefore = await page.evaluate(
    (paragraphId) => window.__DOCX_EDITOR_E2E__!.benchmarkParagraphText(paragraphId),
    prepared!.paragraphId
  );
  await twoFrames(page);
  const heapBeforeBytes = await heapBytes(page);
  if (scenario.input === 'ordered-type') {
    // A browser queues `selectionchange` after programmatic DOM-selection writes. Deliver
    // that echo in the vulnerable window between a model commit and its deferred paint so
    // this scenario deterministically catches stale DOM selection taking ownership back.
    await page.evaluate(() => {
      document.addEventListener(
        'beforeinput',
        () => {
          queueMicrotask(() => document.dispatchEvent(new Event('selectionchange')));
        },
        { capture: true }
      );
    });
  }
  await installBurstProbe(page, injectedDelayMs);
  const client = await page.context().newCDPSession(page);
  const burstDurationMs = burstDurationForScenario(scenario.name);
  const rateHz = scenario.name === 'editing-ordered-type' ? 100 : BURST_RATE_HZ;
  const requestedEvents = Math.max(1, Math.round((burstDurationMs * rateHz) / 1_000));
  const orderedText =
    scenario.input === 'ordered-type'
      ? Array.from({ length: requestedEvents }, (_, index) => '1234567890'[index % 10]!).join('')
      : null;
  const intervalMs = 1_000 / rateHz;
  const completionLatencyMs: number[] = [];
  const pending: Promise<void>[] = [];
  const dispatchStarted = nodePerformance.now();

  for (let index = 0; index < requestedEvents; index += 1) {
    const due = dispatchStarted + index * intervalMs;
    const waitMs = due - nodePerformance.now();
    if (waitMs > 0) await delay(waitMs);
    const sentAt = nodePerformance.now();
    const navigation = burstNavigation(scenario.input);
    const event =
      scenario.input === 'backspace' || scenario.input === 'delete-forward'
        ? {
            type: 'rawKeyDown' as const,
            key: scenario.input === 'backspace' ? 'Backspace' : 'Delete',
            code: scenario.input === 'backspace' ? 'Backspace' : 'Delete',
            windowsVirtualKeyCode: scenario.input === 'backspace' ? 8 : 46,
            nativeVirtualKeyCode: scenario.input === 'backspace' ? 51 : 117,
            autoRepeat: index > 0,
          }
        : navigation
          ? {
              type: 'rawKeyDown' as const,
              ...navigation,
              autoRepeat: index > 0,
            }
          : scenario.input === 'ordered-type'
            ? {
                type: 'keyDown' as const,
                key: orderedText![index]!,
                code: `Digit${orderedText![index]}`,
                text: orderedText![index]!,
                unmodifiedText: orderedText![index]!,
                windowsVirtualKeyCode: orderedText!.charCodeAt(index),
                nativeVirtualKeyCode: orderedText!.charCodeAt(index),
              }
            : {
                type: 'char' as const,
                key: 'X',
                code: 'KeyX',
                text: 'X',
                unmodifiedText: 'X',
              };
    pending.push(
      client.send('Input.dispatchKeyEvent', event).then(() => {
        completionLatencyMs.push(nodePerformance.now() - sentAt);
      })
    );
  }

  const dispatchEnded = nodePerformance.now();
  await Promise.all(pending);
  const navigation = burstNavigation(scenario.input);
  if (scenario.input === 'backspace' || scenario.input === 'delete-forward' || navigation) {
    const deletion = scenario.input === 'backspace' || scenario.input === 'delete-forward';
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...(deletion
        ? {
            key: scenario.input === 'backspace' ? 'Backspace' : 'Delete',
            code: scenario.input === 'backspace' ? 'Backspace' : 'Delete',
            windowsVirtualKeyCode: scenario.input === 'backspace' ? 8 : 46,
            nativeVirtualKeyCode: scenario.input === 'backspace' ? 51 : 117,
          }
        : navigation!),
    });
  }
  const drainedAt = nodePerformance.now();
  for (let frame = 0; frame < 6; frame += 1) await twoFrames(page);
  const probe = await page.evaluate(() => window.__EDIT_BURST_BENCH__!.stop());
  const processedEvents =
    scenario.input === 'type' || scenario.input === 'ordered-type'
      ? probe.beforeInputs
      : probe.keydowns;
  if (scenario.input === 'backspace') {
    await page.waitForFunction(
      (revisionBefore) => (window.__DOCX_EDITOR_E2E__!.layoutRevision() ?? 0) > revisionBefore,
      prepared!.revision,
      { timeout: 15_000 }
    );
  }
  const heapAfterBytes = await heapBytes(page);
  const dom = await page.evaluate(
    (paragraphId) => ({
      nodes: document.querySelectorAll('.docx-pages *').length,
      materializedPages: document.querySelectorAll('.docx-page[data-materialized="true"]').length,
      engine: window.__DOCX_EDITOR_E2E__!.benchmarkPerf()!,
      selection: window.__DOCX_EDITOR_E2E__!.benchmarkSelection(),
      paragraphText: window.__DOCX_EDITOR_E2E__!.benchmarkParagraphText(paragraphId),
      canUndo: window.__DOCX_EDITOR_E2E__!.canUndo(),
      revision: window.__DOCX_EDITOR_E2E__!.layoutRevision(),
    }),
    prepared!.paragraphId
  );
  await client.detach();

  return {
    name: scenario.name,
    mode: scenario.mode,
    requestedEvents,
    processedEvents,
    dispatchWindowMs: dispatchEnded - dispatchStarted,
    drainMs: drainedAt - dispatchEnded,
    completionLatency: summarize(completionLatencyMs),
    handler: probe.handlerMs.length > 0 ? summarize(probe.handlerMs) : null,
    eventDelay: probe.eventDelayMs.length > 0 ? summarize(probe.eventDelayMs) : null,
    longTask: probe.longTasksMs.length > 0 ? summarize(probe.longTasksMs) : null,
    maxFrameGapMs: Math.max(0, ...probe.frameGapsMs),
    heapBeforeBytes,
    heapAfterBytes,
    heapChangeBytes:
      heapBeforeBytes === null || heapAfterBytes === null ? null : heapAfterBytes - heapBeforeBytes,
    peakObservedHeapBytes:
      probe.heapTimeline.length > 0
        ? Math.max(...probe.heapTimeline.map((sample) => sample.usedBytes))
        : null,
    domNodes: dom.nodes,
    materializedPages: dom.materializedPages,
    engine: dom.engine,
    initialSelection: { paragraphId: prepared!.paragraphId, offset: prepared!.offset },
    finalSelection: dom.selection,
    orderedText,
    paragraphTextBefore,
    paragraphTextAfter: dom.paragraphText,
    canUndo: dom.canUndo,
    revisionBefore: prepared!.revision,
    revisionAfter: dom.revision,
    injectedDelayObserved:
      probe.injectedDelayObservedMs.length > 0 ? summarize(probe.injectedDelayObservedMs) : null,
  };
}
