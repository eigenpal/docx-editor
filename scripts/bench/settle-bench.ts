// Keystroke-to-settled latency through the FULL mounted surface, on a huge document.
//
// `bench:edit` measures the store and layout pipeline in isolation; this measures what a
// user feels: one `type()` through the surface's own input, flush, layout, paint and
// selection machinery, until the published state stops moving. It runs headless under
// happy-dom, so absolute paint milliseconds are inflated relative to a browser — compare
// runs on the same machine, and treat the work counters as the hardware-independent part.
// The browser-truth counterpart is `bench:huge:browser` (`typing-url-audit.mjs`).
//
// The default fixture is the pinned 521-page reproduction the browser audit uses, so both
// halves of the huge-document section measure the same bytes. Its SHA-256 is verified
// before a run, and a `--compare` against a baseline taken from different bytes refuses.
//
// Usage:
//   bun scripts/bench/settle-bench.ts [fixture] [--keystrokes 25] [--warmup 3] [--json]
//   bun scripts/bench/settle-bench.ts --json > /tmp/settle-before.json
//   bun scripts/bench/settle-bench.ts --compare /tmp/settle-before.json
//   bun scripts/bench/settle-bench.ts --key enter   # structural keystrokes (splitParagraph)

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createFixedMeasurer } from '../../packages/core/src/layout/index.ts';
import { mountPaginatedSurface } from '../../packages/core/src/editor/paginated-surface.ts';
import type { PaginatedSurface } from '../../packages/core/src/editor/paginated-surface-contract.ts';
import { DEFAULT_FIXTURE, loadTypingPerfFixtureManifest } from './typing-url-audit-lib.mjs';

interface Args {
  fixture: string;
  keystrokes: number;
  warmup: number;
  json: boolean;
  compare?: string;
  /** 'enter' sends a structural keystroke (splitParagraph) instead of typing 'x'. */
  key: 'x' | 'enter';
}

interface TimingSummary {
  medianMs: number;
  p95Ms: number;
}

interface SettleReport {
  schema: 1;
  fixture: string;
  fixtureSha256: string;
  pages: number;
  paragraphs: number;
  openMs: number;
  keystrokes: number;
  settle: TimingSummary;
  layout: TimingSummary;
  paint: TimingSummary;
  work: {
    placed: number;
    total: number;
    reusedPages: number;
    fullPasses: number;
    staleDiscards: number;
    cancelledRuns: number;
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fixture: resolve(import.meta.dir, '../../e2e/fixtures', DEFAULT_FIXTURE),
    keystrokes: 25,
    warmup: 3,
    json: false,
    key: 'x',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === '--json') args.json = true;
    else if (value === '--keystrokes') args.keystrokes = Number(argv[++index]);
    else if (value === '--warmup') args.warmup = Number(argv[++index]);
    else if (value === '--compare') args.compare = argv[++index]!;
    else if (value === '--key') {
      const key = argv[++index];
      if (key !== 'x' && key !== 'enter')
        throw new Error(`--key must be 'x' or 'enter', got ${key}`);
      args.key = key;
    } else if (!value.startsWith('--')) args.fixture = resolve(value);
    else throw new Error(`unknown option ${value}`);
  }
  if (!Number.isInteger(args.keystrokes) || args.keystrokes < 1) {
    throw new Error('--keystrokes must be a positive integer');
  }
  if (!Number.isInteger(args.warmup) || args.warmup < 0) {
    throw new Error('--warmup must be a non-negative integer');
  }
  return args;
}

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

/**
 * Wait until the surface state stops changing for `quiet` consecutive macrotasks, and
 * return the timestamp of the LAST observed change — the moment the keystroke settled.
 * The quiet tail itself is idle waiting, not latency, so it is excluded from the sample.
 */
async function settle(surface: PaginatedSurface, quiet = 25, maxMs = 120_000): Promise<number> {
  const start = performance.now();
  let lastRevision = surface.state().revision;
  let lastChangeAt = performance.now();
  let quietTicks = 0;
  while (quietTicks < quiet) {
    if (performance.now() - start > maxMs) throw new Error('settle timeout');
    await tick();
    const revision = surface.state().revision;
    if (revision !== lastRevision) {
      lastRevision = revision;
      lastChangeAt = performance.now();
      quietTicks = 0;
    } else {
      quietTicks += 1;
    }
  }
  return lastChangeAt;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

async function run(args: Args): Promise<SettleReport> {
  const bytes = new Uint8Array(readFileSync(args.fixture));
  const fixtureSha256 = createHash('sha256').update(bytes).digest('hex');
  if (args.fixture.endsWith(DEFAULT_FIXTURE)) {
    const { entry } = loadTypingPerfFixtureManifest();
    if (entry.sha256 !== fixtureSha256) {
      throw new Error(
        `the pinned fixture's bytes moved: expected sha256 ${entry.sha256}, got ${fixtureSha256}`
      );
    }
  }

  const container = document.createElement('div');
  document.body.append(container);
  // The fixed measurer, not happy-dom's canvas: pagination stays deterministic across
  // environments, so the work counters can be pinned and compared.
  const mounted = mountPaginatedSurface(container, bytes, {
    scale: 1,
    measurer: createFixedMeasurer(6, 14),
  });
  if (!mounted.ok) throw new Error(`mount refused: ${mounted.reason} ${mounted.detail ?? ''}`);
  const surface = mounted.surface;

  try {
    const openStart = performance.now();
    await settle(surface);
    const openMs = performance.now() - openStart;

    const ids = surface.session.paragraphIds();
    const middle = ids[Math.floor(ids.length / 2)]!;
    surface.setSelection({
      anchor: { paragraphId: middle, offset: 0 },
      head: { paragraphId: middle, offset: 0 },
    });
    await settle(surface);

    const press = (): void => {
      // The same call the surface keymap makes for an unmodified Enter.
      if (args.key === 'enter') surface.splitParagraph();
      else surface.type('x');
    };

    for (let index = 0; index < args.warmup; index += 1) {
      press();
      await settle(surface);
    }

    const settleMs: number[] = [];
    const layoutMs: number[] = [];
    const paintMs: number[] = [];
    for (let index = 0; index < args.keystrokes; index += 1) {
      const typedAt = performance.now();
      press();
      const settledAt = await settle(surface);
      settleMs.push(settledAt - typedAt);
      const perf = surface.state().perf;
      layoutMs.push(perf.layoutMs);
      paintMs.push(perf.paintMs);
    }

    const state = surface.state();
    return {
      schema: 1,
      fixture: args.fixture,
      fixtureSha256,
      pages: state.pageCount,
      paragraphs: ids.length,
      openMs: Math.round(openMs),
      keystrokes: args.keystrokes,
      settle: { medianMs: median(settleMs), p95Ms: p95(settleMs) },
      layout: { medianMs: median(layoutMs), p95Ms: p95(layoutMs) },
      paint: { medianMs: median(paintMs), p95Ms: p95(paintMs) },
      work: {
        placed: state.perf.placed,
        total: state.perf.total,
        reusedPages: state.perf.reusedPages,
        fullPasses: state.perf.fullPasses,
        staleDiscards: state.perf.staleDiscards,
        cancelledRuns: state.perf.cancelledRuns,
      },
    };
  } finally {
    surface.destroy();
    container.remove();
  }
}

function printHuman(report: SettleReport): void {
  const line = (label: string, timing: TimingSummary): string =>
    `  ${label} median ${timing.medianMs.toFixed(1)} ms, p95 ${timing.p95Ms.toFixed(1)} ms`;
  console.log(`fixture ${report.fixture}`);
  console.log(
    `pages ${report.pages}, paragraphs ${report.paragraphs}, open ${report.openMs} ms, ` +
      `${report.keystrokes} keystrokes`
  );
  console.log(line('settle', report.settle));
  console.log(line('layout', report.layout));
  console.log(line('paint ', report.paint));
  const work = report.work;
  console.log(
    `  work  placed ${work.placed}/${work.total}, reused ${work.reusedPages} pages, ` +
      `full passes ${work.fullPasses}, stale discards ${work.staleDiscards}`
  );
}

function printComparison(baseline: SettleReport, current: SettleReport): void {
  if (baseline.fixtureSha256 !== current.fixtureSha256) {
    throw new Error('the baseline was taken from different document bytes; refusing to compare');
  }
  const delta = (before: number, after: number): string =>
    `${(((after - before) / before) * 100).toFixed(1)}%`;
  console.log('comparison (negative is faster):');
  console.log(`  settle ${delta(baseline.settle.medianMs, current.settle.medianMs)}`);
  console.log(`  layout ${delta(baseline.layout.medianMs, current.layout.medianMs)}`);
  console.log(`  paint  ${delta(baseline.paint.medianMs, current.paint.medianMs)}`);
  const before = baseline.work;
  const after = current.work;
  console.log(
    `  work   placed ${after.placed - before.placed >= 0 ? '+' : ''}${after.placed - before.placed}, ` +
      `reused ${after.reusedPages - before.reusedPages >= 0 ? '+' : ''}${after.reusedPages - before.reusedPages}, ` +
      `full passes ${after.fullPasses - before.fullPasses >= 0 ? '+' : ''}${after.fullPasses - before.fullPasses}`
  );
}

const args = parseArgs(process.argv.slice(2));
const report = await run(args);
if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
  if (args.compare) {
    const baseline = JSON.parse(readFileSync(resolve(args.compare), 'utf8')) as SettleReport;
    printComparison(baseline, report);
  }
}
process.exit(0);
