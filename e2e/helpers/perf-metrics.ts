/**
 * Perf-metrics collector for the large-document performance specs.
 *
 * Specs call `recordMetric(...)` as they measure, then `writeMetricsIfRequested(suite)`
 * from a `test.afterAll` hook. The JSON file is only written when `PERF_EMIT_JSON`
 * is set, so ordinary test runs are unaffected — the `!check-performance` workflow
 * sets it to capture a machine-readable result it can diff against the committed
 * baseline in `e2e/perf-baselines/`.
 *
 * Run a perf suite with emission locally:
 *   PERF_EMIT_JSON=1 npx playwright test \
 *     e2e/tests/performance-large-docs-comments-suggestions.spec.ts \
 *     --project=chromium --workers=1 --timeout=120000
 */
import * as fs from 'fs';
import * as path from 'path';

/** Whether a higher or lower number is the better outcome for a metric. */
export type MetricDirection = 'lower-is-better' | 'higher-is-better' | 'informational';

export interface PerfMetric {
  /** Stable key used to pair a current metric with its baseline entry. */
  key: string;
  /** Human label shown in the comparison table. */
  label: string;
  /** Measured value. */
  value: number;
  unit: 'ms' | 'count' | 'fps';
  direction: MetricDirection;
}

export interface PerfMetricsFile {
  suite: string;
  capturedAt: string;
  metrics: PerfMetric[];
}

const collected = new Map<string, PerfMetric>();

/**
 * Record (or overwrite) a metric. Keyed by `metric.key`, so re-running a test
 * under Playwright's retry policy simply replaces the earlier sample.
 */
export function recordMetric(metric: PerfMetric): void {
  collected.set(metric.key, metric);
}

/**
 * Write all recorded metrics to `<PERF_OUT_DIR or test-results/perf>/<suite>.json`
 * when `PERF_EMIT_JSON` is set. No-op otherwise. Call once from `test.afterAll`.
 */
export function writeMetricsIfRequested(suite: string): void {
  if (!process.env.PERF_EMIT_JSON) return;
  const outDir = process.env.PERF_OUT_DIR
    ? path.resolve(process.env.PERF_OUT_DIR)
    : path.resolve(process.cwd(), 'test-results/perf');
  fs.mkdirSync(outDir, { recursive: true });
  const payload: PerfMetricsFile = {
    suite,
    capturedAt: new Date().toISOString(),
    metrics: Array.from(collected.values()),
  };
  fs.writeFileSync(path.join(outDir, `${suite}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}
