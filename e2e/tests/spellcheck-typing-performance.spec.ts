import path from 'path';
import { test, expect, Page } from '@playwright/test';

interface RawPerfMetrics {
  longTasks: Array<{ startTime: number; duration: number }>;
  layoutShifts: Array<{ startTime: number; value: number; hadRecentInput: boolean }>;
  frameDeltas: number[];
  typingStart: number;
  typingEnd: number;
  errors?: { longTaskError?: string; layoutShiftError?: string };
}

interface PerfSummary {
  keyLatency: { avg: number; max: number; min: number; samples: number };
  frame: { avg: number; p95: number; max: number; samples: number };
  longTask: { count: number; max: number; total: number };
  cls: number;
  errors?: { longTaskError?: string; layoutShiftError?: string };
}

interface OnChangeProbeSnapshot {
  events: number[];
  workerEnabled: boolean | null;
}

interface LayoutPerfEntry {
  ts: number;
  totalMs: number;
  toFlowBlocksMs: number;
  measureBlocksMs: number;
  layoutDocumentMs: number;
  renderPagesMs: number;
  blocks: number;
  pages: number;
  docSize: number;
  layoutSeq: number;
}

interface LayoutPerfSnapshot {
  entries: LayoutPerfEntry[];
  typingStart: number;
  typingEnd: number;
}

interface SelectionPerfEntry {
  ts: number;
  totalMs: number;
  cellHighlightMs: number;
  caretDomMs: number;
  from: number;
  to: number;
  layoutReady: boolean;
}

interface SelectionPerfSnapshot {
  entries: SelectionPerfEntry[];
  typingStart: number;
  typingEnd: number;
}

interface PMPerfEntry {
  ts: number;
  totalMs: number;
  applyMs: number;
  updateStateMs: number;
  onTransactionMs: number;
  onSelectionMs: number;
  docChanged: boolean;
  selectionSet: boolean;
}

interface PMPerfSnapshot {
  entries: PMPerfEntry[];
  typingStart: number;
  typingEnd: number;
}

interface RenderPerfEntry {
  ts: number;
  totalMs: number;
  path: 'incremental' | 'full';
  useVirtualization: boolean;
  totalPages: number;
  optionsMatch: boolean;
}

interface RenderPerfSnapshot {
  entries: RenderPerfEntry[];
  typingStart: number;
  typingEnd: number;
}

interface TraceEvent {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
}

interface TraceSummary {
  events: number;
  completeEvents: number;
  paint: { count: number; totalMs: number; maxMs: number };
  gc: { count: number; totalMs: number; maxMs: number };
  top: Array<{ name: string; totalMs: number; count: number }>;
}

const KEYSTROKES = 25;
const AB_KEYSTROKES = 15;
const TRACE_SYNC_MARK = 'docx-trace-sync';

async function openEditor(
  page: Page,
  options: { spellcheck?: boolean; overlay?: boolean } = {}
): Promise<void> {
  const params = new URLSearchParams();
  params.set('toolbar', 'ribbon');

  if (options.spellcheck === true) params.set('spellcheck', '1');
  if (options.spellcheck === false) params.set('spellcheck', '0');
  if (options.overlay === false) params.set('spellcheckOverlay', '0');

  await page.goto(`/?${params.toString()}`);
  await page.waitForSelector('[data-testid="docx-editor"]', { timeout: 10000 });
  await page.waitForFunction(() => (document as any).fonts?.ready);
  await page.waitForTimeout(300);
}

async function setupLayoutProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__DOCX_LAYOUT_PROBE__ = true;
    (window as any).__DOCX_LAYOUT_PERF_LOG__ = [];
    (window as any).__DOCX_SELECTION_PERF_LOG__ = [];
    (window as any).__DOCX_PM_PERF_LOG__ = [];
    (window as any).__DOCX_RENDER_PERF_LOG__ = [];
  });
}

async function setupOnChangeProbe(
  page: Page,
  options: { disableWorker?: boolean } = {}
): Promise<void> {
  await page.addInitScript(
    ({ disableWorker }) => {
      (window as any).__DOCX_ONCHANGE_PROBE__ = true;
      (window as any).__DOCX_ONCHANGE_EVENTS__ = [];
      (window as any).__DOCX_DISABLE_WORKER__ = Boolean(disableWorker);
    },
    { disableWorker: options.disableWorker ?? false }
  );
}

async function collectOnChangeProbe(page: Page): Promise<OnChangeProbeSnapshot> {
  return await page.evaluate(() => {
    const win = window as any;
    return {
      events: Array.isArray(win.__DOCX_ONCHANGE_EVENTS__) ? win.__DOCX_ONCHANGE_EVENTS__ : [],
      workerEnabled:
        typeof win.__DOCX_WORKER_ENABLED__ === 'boolean' ? win.__DOCX_WORKER_ENABLED__ : null,
    } as OnChangeProbeSnapshot;
  });
}

async function focusEditor(page: Page): Promise<void> {
  const paragraph = page.locator('[data-page-number] p').first();
  if ((await paragraph.count()) > 0) {
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ position: { x: 20, y: 10 } });
    return;
  }

  const pageEl = page.locator('[data-page-number]').first();
  if ((await pageEl.count()) > 0) {
    await pageEl.scrollIntoViewIfNeeded();
    const box = await pageEl.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 80, box.y + 80);
      return;
    }
  }

  const pages = page.locator('.paged-editor__pages');
  const pagesBox = await pages.boundingBox();
  if (pagesBox) {
    await page.mouse.click(pagesBox.x + 80, pagesBox.y + 80);
    return;
  }

  const editable = page.locator('[contenteditable=\"true\"]').first();
  await editable.scrollIntoViewIfNeeded();
  await editable.click();
}

async function loadDocx(page: Page, filePath: string, expectedFileName: string): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(filePath);
  await page.waitForSelector(`text=${expectedFileName}`, { timeout: 20000 });
  await page.waitForTimeout(600);
}

async function waitForDefaultDocument(page: Page): Promise<void> {
  await page.waitForSelector('text=docx-editor-demo.docx', { timeout: 20000 });
  await page.waitForTimeout(400);
}

async function setupPerfObservers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perf = ((window as any).__docxPerf = {
      longTasks: [],
      layoutShifts: [],
      frameDeltas: [],
      frameActive: false,
      typingStart: 0,
      typingEnd: 0,
      longTaskError: undefined,
      layoutShiftError: undefined,
      _longObs: undefined,
      _lsObs: undefined,
    });

    try {
      const longObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          perf.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      longObs.observe({ entryTypes: ['longtask'] });
      perf._longObs = longObs;
    } catch (err) {
      perf.longTaskError = String(err);
    }

    try {
      const lsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const ls = entry as any;
          perf.layoutShifts.push({
            startTime: entry.startTime,
            value: ls.value ?? 0,
            hadRecentInput: Boolean(ls.hadRecentInput),
          });
        }
      });
      lsObs.observe({ entryTypes: ['layout-shift'] });
      perf._lsObs = lsObs;
    } catch (err) {
      perf.layoutShiftError = String(err);
    }
  });
}

async function startTypingWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perf = (window as any).__docxPerf;
    perf.frameDeltas = [];
    perf.frameActive = true;
    perf.typingStart = performance.now();

    let last = performance.now();
    const tick = (now: number) => {
      if (!perf.frameActive) return;
      perf.frameDeltas.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopTypingWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perf = (window as any).__docxPerf;
    perf.typingEnd = performance.now();
    perf.frameActive = false;
    perf._longObs?.disconnect?.();
    perf._lsObs?.disconnect?.();
  });
}

async function runDebounceScenario(
  page: Page,
  options: { disableWorker: boolean; docPath?: string; docName?: string }
): Promise<{
  perf: RawPerfMetrics;
  onChange: OnChangeProbeSnapshot;
  onChangeWindowed: number[];
  heap: { totalSamples: number; totalMb: number };
  trace: TraceSummary;
}> {
  await setupOnChangeProbe(page, { disableWorker: options.disableWorker });
  await setupLayoutProbe(page);
  await openEditor(page, { spellcheck: true });
  await waitForDefaultDocument(page);
  if (options.docPath && options.docName) {
    await loadDocx(page, options.docPath, options.docName);
  }
  await focusEditor(page);

  const trace = await startTrace(page);
  const heapClient = await createHeapSession(page);
  await startHeapSampling(heapClient);

  await setupPerfObservers(page);
  await startTypingWindow(page);
  await measureKeystrokes(page, KEYSTROKES, 'a');
  await stopTypingWindow(page);

  await page.waitForTimeout(1200);

  const perf = await collectPerfMetrics(page);
  await stopTrace(trace.client);
  const syncTraceTs = findTraceMarkTs(trace.events, TRACE_SYNC_MARK);
  if (!syncTraceTs) {
    throw new Error('Trace sync mark missing');
  }
  const startTs = syncTraceTs + (perf.typingStart - trace.syncPerfNow) * 1000;
  const endTs = syncTraceTs + (perf.typingEnd - trace.syncPerfNow) * 1000;
  const traceSummary = summarizeTraceWindow(trace.events, startTs, endTs);
  const onChange = await collectOnChangeProbe(page);
  const samplingProfile = await stopHeapSampling(heapClient);
  await heapClient.detach();
  const heapSummary = summarizeHeapSampling(samplingProfile);

  const bufferMs = 1200;
  const onChangeWindowed = onChange.events.filter(
    (ts) => ts >= perf.typingStart && ts <= perf.typingEnd + bufferMs
  );

  return {
    perf,
    onChange,
    onChangeWindowed,
    heap: { totalSamples: heapSummary.totalSamples, totalMb: heapSummary.totalMb },
    trace: traceSummary,
  };
}

async function collectPerfMetrics(page: Page): Promise<RawPerfMetrics> {
  return await page.evaluate(() => {
    const perf = (window as any).__docxPerf || {};
    return {
      longTasks: perf.longTasks || [],
      layoutShifts: perf.layoutShifts || [],
      frameDeltas: perf.frameDeltas || [],
      typingStart: perf.typingStart || 0,
      typingEnd: perf.typingEnd || 0,
      errors: {
        longTaskError: perf.longTaskError,
        layoutShiftError: perf.layoutShiftError,
      },
    } as RawPerfMetrics;
  });
}

async function collectLayoutPerf(page: Page): Promise<LayoutPerfSnapshot> {
  return await page.evaluate(() => {
    return {
      entries: (window as any).__DOCX_LAYOUT_PERF_LOG__ || [],
      typingStart: (window as any).__docxPerf?.typingStart || 0,
      typingEnd: (window as any).__docxPerf?.typingEnd || 0,
    } as LayoutPerfSnapshot;
  });
}

async function collectSelectionPerf(page: Page): Promise<SelectionPerfSnapshot> {
  return await page.evaluate(() => {
    return {
      entries: (window as any).__DOCX_SELECTION_PERF_LOG__ || [],
      typingStart: (window as any).__docxPerf?.typingStart || 0,
      typingEnd: (window as any).__docxPerf?.typingEnd || 0,
    } as SelectionPerfSnapshot;
  });
}

async function collectPMPerf(page: Page): Promise<PMPerfSnapshot> {
  return await page.evaluate(() => {
    return {
      entries: (window as any).__DOCX_PM_PERF_LOG__ || [],
      typingStart: (window as any).__docxPerf?.typingStart || 0,
      typingEnd: (window as any).__docxPerf?.typingEnd || 0,
    } as PMPerfSnapshot;
  });
}

async function collectRenderPerf(page: Page): Promise<RenderPerfSnapshot> {
  return await page.evaluate(() => {
    return {
      entries: (window as any).__DOCX_RENDER_PERF_LOG__ || [],
      typingStart: (window as any).__docxPerf?.typingStart || 0,
      typingEnd: (window as any).__docxPerf?.typingEnd || 0,
    } as RenderPerfSnapshot;
  });
}

async function startTrace(
  page: Page
): Promise<{ client: any; events: TraceEvent[]; syncPerfNow: number }> {
  const client = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];

  client.on('Tracing.dataCollected', (payload: { value: TraceEvent[] }) => {
    events.push(...payload.value);
  });

  const categories = [
    'devtools.timeline',
    'blink.user_timing',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-v8.gc',
    'v8',
  ].join(',');

  await client.send('Tracing.start', { categories, transferMode: 'ReportEvents' });

  const syncPerfNow = await page.evaluate((markName: string) => {
    performance.mark(markName);
    return performance.now();
  }, TRACE_SYNC_MARK);

  return { client, events, syncPerfNow };
}

async function stopTrace(client: any): Promise<void> {
  const tracingComplete = new Promise<void>((resolve) => {
    client.once('Tracing.tracingComplete', resolve);
  });

  try {
    await client.send('Tracing.stop');
  } catch {
    await client.send('Tracing.end');
  }
  await tracingComplete;
}

function findTraceMarkTs(events: TraceEvent[], markName: string): number | null {
  const hit = events.find((event) => event.name === markName && typeof event.ts === 'number');
  return hit?.ts ?? null;
}

async function createHeapSession(page: Page): Promise<any> {
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.enable');
  await client.send('Runtime.enable');
  return client;
}

async function startHeapSampling(client: any): Promise<void> {
  await client.send('HeapProfiler.startSampling', { samplingInterval: 32768 });
}

async function stopHeapSampling(client: any): Promise<any> {
  const result = await client.send('HeapProfiler.stopSampling');
  return result?.profile;
}

async function getHeapUsage(client: any): Promise<{ usedMb: number; totalMb: number }> {
  const result = await client.send('Runtime.getHeapUsage');
  const usedSize = result?.usedSize ?? 0;
  const totalSize = result?.totalSize ?? 0;
  return {
    usedMb: Math.round((usedSize / (1024 * 1024)) * 100) / 100,
    totalMb: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
  };
}

function summarizeHeapSampling(profile: any): {
  totalSamples: number;
  totalMb: number;
  top: Array<{ name: string; sizeMb: number; samples: number }>;
} {
  if (!profile) {
    return { totalSamples: 0, totalMb: 0, top: [] };
  }

  const nodeMap = new Map<number, any>();
  const walk = (node: any) => {
    if (!node) return;
    nodeMap.set(node.id, node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(profile.head);

  const totalsByFn = new Map<string, { size: number; count: number }>();
  let totalSize = 0;

  if (Array.isArray(profile.samples)) {
    for (const sample of profile.samples) {
      const size = sample.size ?? 0;
      totalSize += size;
      const node = nodeMap.get(sample.nodeId);
      const frame = node?.callFrame;
      const fn = frame?.functionName || '(anonymous)';
      const url = frame?.url ? frame.url.split('/').pop() : '';
      const name = url ? `${fn} (${url})` : fn;
      const entry = totalsByFn.get(name) ?? { size: 0, count: 0 };
      entry.size += size;
      entry.count += 1;
      totalsByFn.set(name, entry);
    }
  }

  const top = Array.from(totalsByFn.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 8)
    .map(([name, stats]) => ({
      name,
      sizeMb: Math.round((stats.size / (1024 * 1024)) * 100) / 100,
      samples: stats.count,
    }));

  return {
    totalSamples: profile.samples?.length ?? 0,
    totalMb: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
    top,
  };
}

async function takeHeapSnapshot(client: any): Promise<{ sizeMb: number }> {
  let totalBytes = 0;
  const onChunk = (payload: { chunk: string }) => {
    totalBytes += payload.chunk.length;
  };

  client.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  client.off('HeapProfiler.addHeapSnapshotChunk', onChunk);

  return {
    sizeMb: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
  };
}

async function measureKeystrokeLatency(page: Page, key: string = 'a'): Promise<number> {
  const before = performance.now();
  await page.keyboard.press(key);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  );
  return Math.round(performance.now() - before);
}

async function measureKeystrokes(
  page: Page,
  count: number,
  key: string = 'a'
): Promise<{ latencies: number[]; avg: number; max: number; min: number }> {
  const latencies: number[] = [];
  for (let i = 0; i < count; i++) {
    latencies.push(await measureKeystrokeLatency(page, key));
  }
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  return { latencies, avg, max: Math.max(...latencies), min: Math.min(...latencies) };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function summarizeLayoutPerf(entries: LayoutPerfEntry[]) {
  const stats = (values: number[]) => ({
    avg: Math.round(mean(values)),
    p95: Math.round(percentile(values, 95)),
    max: values.length ? Math.round(Math.max(...values)) : 0,
    samples: values.length,
  });

  const totals = entries.map((entry) => entry.totalMs);
  const toFlow = entries.map((entry) => entry.toFlowBlocksMs);
  const measures = entries.map((entry) => entry.measureBlocksMs);
  const layouts = entries.map((entry) => entry.layoutDocumentMs);
  const renders = entries.map((entry) => entry.renderPagesMs);
  const intervals = entries.slice(1).map((entry, idx) => entry.ts - entries[idx].ts);

  return {
    runs: entries.length,
    total: stats(totals),
    toFlowBlocks: stats(toFlow),
    measureBlocks: stats(measures),
    layoutDocument: stats(layouts),
    renderPages: stats(renders),
    interval: stats(intervals),
  };
}

function summarizeSelectionPerf(entries: SelectionPerfEntry[]) {
  const stats = (values: number[]) => ({
    avg: Math.round(mean(values)),
    p95: Math.round(percentile(values, 95)),
    max: values.length ? Math.round(Math.max(...values)) : 0,
    samples: values.length,
  });

  const totals = entries.map((entry) => entry.totalMs);
  const cells = entries.map((entry) => entry.cellHighlightMs);
  const caret = entries.map((entry) => entry.caretDomMs);
  const intervals = entries.slice(1).map((entry, idx) => entry.ts - entries[idx].ts);
  const layoutReadyCount = entries.filter((entry) => entry.layoutReady).length;

  return {
    runs: entries.length,
    layoutReady: layoutReadyCount,
    total: stats(totals),
    cellHighlight: stats(cells),
    caretDom: stats(caret),
    interval: stats(intervals),
  };
}

function summarizePMPerf(entries: PMPerfEntry[]) {
  const stats = (values: number[]) => ({
    avg: Math.round(mean(values)),
    p95: Math.round(percentile(values, 95)),
    max: values.length ? Math.round(Math.max(...values)) : 0,
    samples: values.length,
  });

  const totals = entries.map((entry) => entry.totalMs);
  const apply = entries.map((entry) => entry.applyMs);
  const update = entries.map((entry) => entry.updateStateMs);
  const onTransaction = entries.map((entry) => entry.onTransactionMs);
  const onSelection = entries.map((entry) => entry.onSelectionMs);
  const intervals = entries.slice(1).map((entry, idx) => entry.ts - entries[idx].ts);

  return {
    runs: entries.length,
    total: stats(totals),
    apply: stats(apply),
    updateState: stats(update),
    onTransaction: stats(onTransaction),
    onSelection: stats(onSelection),
    interval: stats(intervals),
  };
}

function summarizeRenderPerf(entries: RenderPerfEntry[]) {
  const stats = (values: number[]) => ({
    avg: Math.round(mean(values)),
    p95: Math.round(percentile(values, 95)),
    max: values.length ? Math.round(Math.max(...values)) : 0,
    samples: values.length,
  });

  const totals = entries.map((entry) => entry.totalMs);
  const intervals = entries.slice(1).map((entry, idx) => entry.ts - entries[idx].ts);
  const paths = entries.reduce(
    (acc, entry) => {
      acc[entry.path] += 1;
      return acc;
    },
    { incremental: 0, full: 0 } as { incremental: number; full: number }
  );
  const virtualized = entries.filter((entry) => entry.useVirtualization).length;

  return {
    runs: entries.length,
    total: stats(totals),
    interval: stats(intervals),
    paths,
    virtualized,
  };
}

function summarizeTraceWindow(events: TraceEvent[], startTs: number, endTs: number): TraceSummary {
  const windowed = events.filter(
    (event) => typeof event.ts === 'number' && event.ts >= startTs && event.ts <= endTs
  );
  const complete = windowed.filter((event) => event.ph === 'X' && typeof event.dur === 'number');

  const sum = (filtered: TraceEvent[]) => {
    let total = 0;
    let max = 0;
    for (const event of filtered) {
      const dur = (event.dur ?? 0) / 1000;
      total += dur;
      if (dur > max) max = dur;
    }
    return { count: filtered.length, totalMs: Math.round(total), maxMs: Math.round(max) };
  };

  const paintNames = new Set([
    'Paint',
    'PrePaint',
    'CompositeLayers',
    'UpdateLayerTree',
    'Layout',
    'RasterTask',
    'Rasterize',
    'Commit',
    'DrawFrame',
    'ImageDecodeTask',
  ]);
  const gcPattern = /(GC|Scavenge|Mark|Sweep)/i;

  const paintEvents = complete.filter((event) => paintNames.has(event.name ?? ''));
  const gcEvents = complete.filter((event) => gcPattern.test(event.name ?? ''));

  const totalsByName = new Map<string, { totalMs: number; count: number }>();
  for (const event of complete) {
    const name = event.name ?? 'unknown';
    const durMs = (event.dur ?? 0) / 1000;
    const entry = totalsByName.get(name) ?? { totalMs: 0, count: 0 };
    entry.totalMs += durMs;
    entry.count += 1;
    totalsByName.set(name, entry);
  }

  const top = Array.from(totalsByName.entries())
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 8)
    .map(([name, stats]) => ({
      name,
      totalMs: Math.round(stats.totalMs),
      count: stats.count,
    }));

  return {
    events: windowed.length,
    completeEvents: complete.length,
    paint: sum(paintEvents),
    gc: sum(gcEvents),
    top,
  };
}

function summarizePerf(
  raw: RawPerfMetrics,
  keyStats: { avg: number; max: number; min: number; latencies: number[] }
): PerfSummary {
  const inWindow = (t: number) => t >= raw.typingStart && t <= raw.typingEnd + 16;
  const longTasks = raw.longTasks.filter((entry) => inWindow(entry.startTime));
  const layoutShifts = raw.layoutShifts.filter((entry) => inWindow(entry.startTime));

  const cls = layoutShifts.reduce((sum, entry) => sum + (entry.value || 0), 0);
  const frameAvg = Math.round(mean(raw.frameDeltas));
  const frameP95 = Math.round(percentile(raw.frameDeltas, 95));
  const frameMax = raw.frameDeltas.length ? Math.max(...raw.frameDeltas) : 0;

  return {
    keyLatency: {
      avg: keyStats.avg,
      max: keyStats.max,
      min: keyStats.min,
      samples: keyStats.latencies.length,
    },
    frame: {
      avg: frameAvg,
      p95: frameP95,
      max: frameMax,
      samples: raw.frameDeltas.length,
    },
    longTask: {
      count: longTasks.length,
      max: longTasks.length ? Math.round(Math.max(...longTasks.map((t) => t.duration))) : 0,
      total: Math.round(longTasks.reduce((sum, t) => sum + t.duration, 0)),
    },
    cls: Math.round(cls * 1000) / 1000,
    errors: raw.errors,
  };
}

test.describe('Spellcheck typing performance (ribbon)', () => {
  test('metrics-only probe (spellcheck on)', async ({ page }) => {
    await openEditor(page, { spellcheck: true });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);

    const keyStats = await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const raw = await collectPerfMetrics(page);
    const summary = summarizePerf(raw, keyStats);

    console.log('[perf][spellcheck:on]', summary);

    await expect(page.locator('[contenteditable="true"]').first()).toContainText('a');
  });

  test('soft thresholds (spellcheck on)', async ({ page }) => {
    await openEditor(page, { spellcheck: true });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);

    const keyStats = await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const raw = await collectPerfMetrics(page);
    const summary = summarizePerf(raw, keyStats);

    console.log('[perf][spellcheck:on][thresholds]', summary);

    expect(summary.keyLatency.avg).toBeLessThan(700);
    expect(summary.keyLatency.max).toBeLessThan(1000);
    expect(summary.frame.p95).toBeLessThan(600);
  });

  test('debounce probe (spellcheck on)', async ({ page }) => {
    test.setTimeout(120000);

    const defaultDoc = await runDebounceScenario(page, { disableWorker: false });

    expect(defaultDoc.onChange.workerEnabled).toBe(true);
    expect(defaultDoc.onChangeWindowed.length).toBeGreaterThan(0);
    expect(defaultDoc.onChangeWindowed.length).toBeLessThan(KEYSTROKES);

    console.log('[perf][debounce][default]', {
      onChange: defaultDoc.onChangeWindowed.length,
      heapMb: defaultDoc.heap.totalMb,
      heapSamples: defaultDoc.heap.totalSamples,
      gcMs: defaultDoc.trace.gc.totalMs,
    });

    const largeDoc = path.resolve(process.cwd(), 'e2e', 'fixtures', 'issue-68-large.docx');
    const withWorkerLarge = await runDebounceScenario(page, {
      disableWorker: false,
      docPath: largeDoc,
      docName: 'issue-68-large.docx',
    });

    const withoutWorkerPage = await page.context().newPage();
    const withoutWorkerLarge = await runDebounceScenario(withoutWorkerPage, {
      disableWorker: true,
      docPath: largeDoc,
      docName: 'issue-68-large.docx',
    });
    await withoutWorkerPage.close();

    expect(withoutWorkerLarge.onChange.workerEnabled).toBe(false);
    expect(withoutWorkerLarge.onChangeWindowed.length).toBeGreaterThan(0);

    console.log('[perf][debounce][large]', {
      workerOn: {
        onChange: withWorkerLarge.onChangeWindowed.length,
        heapMb: withWorkerLarge.heap.totalMb,
        heapSamples: withWorkerLarge.heap.totalSamples,
        gcMs: withWorkerLarge.trace.gc.totalMs,
      },
      workerOff: {
        onChange: withoutWorkerLarge.onChangeWindowed.length,
        heapMb: withoutWorkerLarge.heap.totalMb,
        heapSamples: withoutWorkerLarge.heap.totalSamples,
        gcMs: withoutWorkerLarge.trace.gc.totalMs,
      },
    });

    const gcToleranceMs = Math.max(5, Math.round(withoutWorkerLarge.trace.gc.totalMs * 0.2));
    expect(withWorkerLarge.trace.gc.totalMs).toBeLessThanOrEqual(
      withoutWorkerLarge.trace.gc.totalMs + gcToleranceMs
    );
  });

  test('A/B probe (spellcheck on vs overlay off vs off)', async ({ page }) => {
    test.setTimeout(90000);
    await openEditor(page, { spellcheck: true });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    const withKeyStats = await measureKeystrokes(page, AB_KEYSTROKES, 'a');
    await stopTypingWindow(page);
    const withRaw = await collectPerfMetrics(page);
    const withSummary = summarizePerf(withRaw, withKeyStats);

    await openEditor(page, { spellcheck: true, overlay: false });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    const overlayOffKeyStats = await measureKeystrokes(page, AB_KEYSTROKES, 'a');
    await stopTypingWindow(page);
    const overlayOffRaw = await collectPerfMetrics(page);
    const overlayOffSummary = summarizePerf(overlayOffRaw, overlayOffKeyStats);

    await openEditor(page, { spellcheck: false });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    const withoutKeyStats = await measureKeystrokes(page, AB_KEYSTROKES, 'a');
    await stopTypingWindow(page);
    const withoutRaw = await collectPerfMetrics(page);
    const withoutSummary = summarizePerf(withoutRaw, withoutKeyStats);

    console.log('[perf][spellcheck:ab]', {
      with: withSummary,
      overlayOff: overlayOffSummary,
      without: withoutSummary,
    });
  });

  test('layout pipeline probe (spellcheck on)', async ({ page }) => {
    await setupLayoutProbe(page);
    await openEditor(page, { spellcheck: true });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const snapshot = await collectLayoutPerf(page);
    const inWindow = (entry: LayoutPerfEntry) =>
      entry.ts >= snapshot.typingStart && entry.ts <= snapshot.typingEnd + 16;
    const windowed = snapshot.entries.filter(inWindow);
    const summary = summarizeLayoutPerf(windowed);

    console.log('[perf][layout]', summary);

    expect(snapshot.entries.length).toBeGreaterThan(0);
  });

  test('render path probe (spellcheck on)', async ({ page }) => {
    await setupLayoutProbe(page);
    await openEditor(page, { spellcheck: true });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const snapshot = await collectRenderPerf(page);
    const inWindow = (entry: RenderPerfEntry) =>
      entry.ts >= snapshot.typingStart && entry.ts <= snapshot.typingEnd + 16;
    const windowed = snapshot.entries.filter(inWindow);
    const summary = summarizeRenderPerf(windowed);

    console.log('[perf][render]', summary);

    expect(snapshot.entries.length).toBeGreaterThan(0);
    expect(summary.paths.incremental).toBeGreaterThan(0);
  });

  test('trace probe (spellcheck on)', async ({ page }) => {
    await setupLayoutProbe(page);
    await openEditor(page, { spellcheck: true });
    await waitForDefaultDocument(page);
    await focusEditor(page);

    const trace = await startTrace(page);
    await setupPerfObservers(page);
    await startTypingWindow(page);
    await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const perfRaw = await collectPerfMetrics(page);
    await stopTrace(trace.client);

    const syncTraceTs = findTraceMarkTs(trace.events, TRACE_SYNC_MARK);
    expect(syncTraceTs).not.toBeNull();
    if (!syncTraceTs) return;

    const startTs = syncTraceTs + (perfRaw.typingStart - trace.syncPerfNow) * 1000;
    const endTs = syncTraceTs + (perfRaw.typingEnd - trace.syncPerfNow) * 1000;
    const summary = summarizeTraceWindow(trace.events, startTs, endTs);

    console.log('[perf][trace]', summary);

    expect(summary.completeEvents).toBeGreaterThan(0);
  });

  test('heap probe (spellcheck on)', async ({ page }) => {
    await setupLayoutProbe(page);
    await openEditor(page, { spellcheck: true });
    await waitForDefaultDocument(page);
    await focusEditor(page);

    const heapClient = await createHeapSession(page);
    await startHeapSampling(heapClient);
    const heapBefore = await getHeapUsage(heapClient);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const heapAfter = await getHeapUsage(heapClient);
    const samplingProfile = await stopHeapSampling(heapClient);
    const samplingSummary = summarizeHeapSampling(samplingProfile);
    const snapshotSummary = await takeHeapSnapshot(heapClient);
    await heapClient.detach();

    console.log('[perf][heap]', {
      usage: {
        beforeMb: heapBefore.usedMb,
        afterMb: heapAfter.usedMb,
        deltaMb: Math.round((heapAfter.usedMb - heapBefore.usedMb) * 100) / 100,
      },
      sampling: samplingSummary,
      samplingTop: samplingSummary.top.map(
        (entry) => `${entry.name}: ${entry.sizeMb}MB (${entry.samples} samples)`
      ),
      snapshot: snapshotSummary,
    });

    expect(samplingSummary.totalSamples).toBeGreaterThan(0);
  });

  test('selection overlay probe (spellcheck on)', async ({ page }) => {
    await setupLayoutProbe(page);
    await openEditor(page, { spellcheck: true });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const snapshot = await collectSelectionPerf(page);
    const inWindow = (entry: SelectionPerfEntry) =>
      entry.ts >= snapshot.typingStart && entry.ts <= snapshot.typingEnd + 16;
    const windowed = snapshot.entries.filter(inWindow);
    const summary = summarizeSelectionPerf(windowed);

    console.log('[perf][selection]', summary);

    expect(snapshot.entries.length).toBeGreaterThan(0);
  });

  test('pm transaction probe (spellcheck on)', async ({ page }) => {
    await setupLayoutProbe(page);
    await openEditor(page, { spellcheck: true });
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const snapshot = await collectPMPerf(page);
    const inWindow = (entry: PMPerfEntry) =>
      entry.ts >= snapshot.typingStart && entry.ts <= snapshot.typingEnd + 16;
    const windowed = snapshot.entries.filter(inWindow);
    const summary = summarizePMPerf(windowed);

    console.log('[perf][pm]', summary);

    expect(snapshot.entries.length).toBeGreaterThan(0);
  });

  test('large doc typing probe (spellcheck on)', async ({ page }) => {
    test.setTimeout(120000);
    await setupLayoutProbe(page);
    await openEditor(page, { spellcheck: true });

    const largeDoc = path.resolve(process.cwd(), 'e2e', 'fixtures', 'issue-68-large.docx');
    await loadDocx(page, largeDoc, 'issue-68-large.docx');
    await focusEditor(page);

    await setupPerfObservers(page);
    await startTypingWindow(page);
    const keyStats = await measureKeystrokes(page, KEYSTROKES, 'a');
    await stopTypingWindow(page);

    const perfRaw = await collectPerfMetrics(page);
    const perfSummary = summarizePerf(perfRaw, keyStats);

    const layoutSnapshot = await collectLayoutPerf(page);
    const layoutWindowed = layoutSnapshot.entries.filter(
      (entry) => entry.ts >= layoutSnapshot.typingStart && entry.ts <= layoutSnapshot.typingEnd + 16
    );
    const layoutSummary = summarizeLayoutPerf(layoutWindowed);

    const selectionSnapshot = await collectSelectionPerf(page);
    const selectionWindowed = selectionSnapshot.entries.filter(
      (entry) =>
        entry.ts >= selectionSnapshot.typingStart && entry.ts <= selectionSnapshot.typingEnd + 16
    );
    const selectionSummary = summarizeSelectionPerf(selectionWindowed);

    const pmSnapshot = await collectPMPerf(page);
    const pmWindowed = pmSnapshot.entries.filter(
      (entry) => entry.ts >= pmSnapshot.typingStart && entry.ts <= pmSnapshot.typingEnd + 16
    );
    const pmSummary = summarizePMPerf(pmWindowed);

    const renderSnapshot = await collectRenderPerf(page);
    const renderWindowed = renderSnapshot.entries.filter(
      (entry) => entry.ts >= renderSnapshot.typingStart && entry.ts <= renderSnapshot.typingEnd + 16
    );
    const renderSummary = summarizeRenderPerf(renderWindowed);

    console.log('[perf][large-doc]', {
      typing: perfSummary,
      layout: layoutSummary,
      selection: selectionSummary,
      pm: pmSummary,
      render: renderSummary,
    });

    expect(perfSummary.keyLatency.avg).toBeLessThan(1500);
  });
});
