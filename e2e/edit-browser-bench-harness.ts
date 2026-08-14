import { type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5275;
const FIXTURE = 'synthetic-long-edit.docx';
const REVIEW_RAIL_ENABLED = process.env.EDIT_BROWSER_BENCH_REVIEW_RAIL !== '0';

export const EDIT_BROWSER_BENCH_URL = `http://localhost:${PORT}/?perfE2e=1&fixture=${FIXTURE}&reviewRail=${
  REVIEW_RAIL_ENABLED ? '1' : '0'
}`;

export interface EnginePerf {
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

export interface BrowserSample {
  readonly inputTaskMs: number;
  readonly frameMs: number;
  readonly eventDurationMs: number | null;
  readonly eventDelayMs: number | null;
  readonly engine: EnginePerf;
  readonly domNodes: number;
  readonly materializedPages: number;
  readonly selectionSpans: number;
}

export interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`expected positive integer: ${value}`);
  return parsed;
}

export function nonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`expected non-negative number: ${value}`);
  return parsed;
}

export function summarize(values: readonly number[]): TimingSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)]!,
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
  };
}

export function summarizeOptional(values: readonly (number | null)[]): TimingSummary | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? summarize(present) : null;
}

export async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

export async function heapBytes(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const collect = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    collect?.();
    const memory = (
      performance as Performance & {
        memory?: { readonly usedJSHeapSize: number };
      }
    ).memory;
    return memory?.usedJSHeapSize ?? null;
  });
}

export function percentChange(next: number, before: number): number {
  return before === 0 ? 0 : ((next - before) / before) * 100;
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadHarness(
  page: Page,
  installMeasurementProbe: (page: Page) => Promise<void>,
  measurementProbe = true
): Promise<void> {
  await page.goto(EDIT_BROWSER_BENCH_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__DOCX_EDITOR_E2E__?.ready());
  await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.fontMeasurer() === 'shaped');
  await page.waitForSelector('.docx-page[data-materialized="true"]', { timeout: 60_000 });
  if (measurementProbe) await installMeasurementProbe(page);
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EDIT_BROWSER_FIXTURE = FIXTURE;
