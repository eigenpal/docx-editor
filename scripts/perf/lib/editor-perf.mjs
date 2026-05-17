import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PERF_DIR = path.join(
  ROOT,
  'openspec/changes/vue-editor-robust-implementation/notes/perf'
);
const DEFAULT_PERF_OUTPUT_DIR = process.env.PERF_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.PERF_OUTPUT_DIR)
  : path.join(ROOT, 'test-results/perf');
export const PARA_ID_FIXTURE = path.join(ROOT, 'e2e/fixtures/example-with-image.docx');

export const ADAPTERS = [
  {
    name: 'react',
    url: process.env.REACT_URL ?? 'http://localhost:5173/?e2e=1',
    readySelector: '[data-testid="docx-editor"]',
  },
  {
    name: 'vue',
    url: process.env.VUE_URL ?? 'http://localhost:5174/?e2e=1',
    readySelector: '.docx-editor-vue',
  },
];

const spawnedServers = [];

async function canReach(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canReach(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function ensurePerfServers() {
  const reactReady = await canReach('http://localhost:5173');
  const vueReady = await canReach('http://localhost:5174');
  if (reactReady && vueReady) return;

  if (!reactReady) {
    const child = spawn('bun', ['run', 'dev'], {
      cwd: ROOT,
      stdio: process.env.PERF_SERVER_LOGS === '1' ? 'inherit' : 'ignore',
    });
    child.unref();
    spawnedServers.push(child);
  }
  if (!vueReady) {
    const child = spawn('bun', ['run', 'dev:vue'], {
      cwd: ROOT,
      stdio: process.env.PERF_SERVER_LOGS === '1' ? 'inherit' : 'ignore',
    });
    child.unref();
    spawnedServers.push(child);
  }

  await Promise.all([
    reactReady ? Promise.resolve() : waitForUrl('http://localhost:5173'),
    vueReady ? Promise.resolve() : waitForUrl('http://localhost:5174'),
  ]);
}

process.on('exit', () => {
  for (const child of spawnedServers) child.kill();
});

export async function withBrowser(callback) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    return await callback(page);
  } finally {
    await browser.close();
  }
}

export async function openAdapter(page, adapter) {
  await page.goto(adapter.url);
  await page.waitForSelector(adapter.readySelector, { timeout: 25000 });
  await page.waitForSelector('.paged-editor__pages', { timeout: 25000 });
}

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

export function writePerfResult(metric, data) {
  const sha = process.env.GITHUB_SHA?.slice(0, 12);
  const shouldWriteArtifacts = process.env.PERF_WRITE_ARTIFACTS === '1' || Boolean(sha);
  const outDir = shouldWriteArtifacts ? PERF_DIR : DEFAULT_PERF_OUTPUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const shouldWriteHistory = process.env.PERF_WRITE_HISTORY === '1' || Boolean(sha);
  const fileName = shouldWriteHistory ? `${metric}-${sha ?? 'local'}-${Date.now()}.json` : `${metric}-latest.json`;
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(
    outPath,
    `${JSON.stringify({ metric, timestamp: new Date().toISOString(), ...data }, null, 2)}\n`
  );
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
  return outPath;
}

export function assertThreshold(condition, message) {
  if (!condition) {
    console.error(message);
    process.exitCode = 1;
  }
}
