/** Browser eval probe. Inputs and evidence stay outside the repository. */
import { chromium, type Page } from '@playwright/test';
import { gc } from 'bun';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticHarness } from './evaluation-static.ts';
import type { DocxEditorInstance } from '../packages/core/src/editor/docx-editor.ts';
import type { DocxEditorE2EHook } from '../examples/vite/src/test-harness/table-editing-e2e-hook.ts';

declare global {
  interface Window {
    __DOCX_EDITOR_E2E__?: DocxEditorE2EHook;
  }
}

type Job = { input: string; output: string; artifacts?: string };
const emit = (value: string) => process.stdout.write(`${value}\n`);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPE = 'pointer-insert-undo-redo-v1';
const MAX_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
const VIEWPORT = { width: 1280, height: 1000 };
let browserPath: string | undefined;
async function browserExecutable(): Promise<string> {
  if (browserPath) return browserPath;
  let directory = dirname(chromium.executablePath());
  while (!/^chromium-\d+$/.test(basename(directory)) && dirname(directory) !== directory)
    directory = dirname(directory);
  if (!/^chromium-\d+$/.test(basename(directory)))
    throw new Error('Cannot locate the pinned Chromium installation');
  const shell = resolve(
    dirname(directory),
    basename(directory).replace('chromium-', 'chromium_headless_shell-')
  );
  const visit = async (folder: string, depth: number): Promise<string | undefined> => {
    if (depth > 3) return undefined;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        ['chrome-headless-shell', 'headless_shell', 'headless_shell.exe'].includes(entry.name)
      )
        return resolve(folder, entry.name);
      if (entry.isDirectory()) {
        const found = await visit(resolve(folder, entry.name), depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  try {
    browserPath = await visit(shell, 0);
  } catch {
    /* Installation guidance below. */
  }
  if (!browserPath)
    throw new Error('Install the pinned headless browser with: bunx playwright install chromium');
  return browserPath;
}
type Identity = Awaited<ReturnType<typeof identity>>;

async function fileHash(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function identity() {
  const node = spawnSync('node', ['--version'], { encoding: 'utf8' });
  if (node.status !== 0) throw new Error('Node.js is required to build the browser harness');
  const fontRoot = resolve(ROOT, 'packages/fonts/assets');
  const fonts: string[] = [];
  for (const name of (await readdir(fontRoot)).sort()) {
    if (/\.(?:ttf|otf|woff2?)$/.test(name))
      fonts.push(`${name}:${await fileHash(resolve(fontRoot, name))}`);
  }
  return {
    protocol: 1,
    recipe: RECIPE,
    recipeHash: await fileHash(fileURLToPath(import.meta.url)),
    browserExecutableHash: await fileHash(await browserExecutable()),
    browserMode: 'headless-shell-per-document',
    traceMode: 'actions-with-failure-screenshot',
    harnessMode: 'static-production',
    buildNodeVersion: node.stdout.trim(),
    buildHeapMiB: 512,
    rendererHeapMiB: 192,
    fontAssetsHash: hash(fonts.join('\n')),
    viewport: VIEWPORT,
    platform: process.platform,
    architecture: process.arch,
    playwrightVersion: JSON.parse(
      await readFile(fileURLToPath(import.meta.resolve('@playwright/test/package.json')), 'utf8')
    ).version as string,
    bunVersion: process.versions.bun ?? null,
  };
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

type GeometryDifference = { path: string; incremental: unknown; reopened: unknown };
function firstGeometryDifference(
  before: unknown,
  after: unknown,
  path = 'pages'
): GeometryDifference | null {
  if (before === after) return null;
  const compact = (value: unknown) =>
    typeof value === 'string'
      ? { sha256: hash(value), length: value.length }
      : value !== null && typeof value === 'object'
        ? { keys: Object.keys(value).slice(0, 10) }
        : (value ?? null);
  if (
    before === null ||
    after === null ||
    typeof before !== 'object' ||
    typeof after !== 'object'
  ) {
    return { path, incremental: compact(before), reopened: compact(after) };
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length) {
    return { path: `${path}.length`, incremental: before.length, reopened: after.length };
  }
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const difference = firstGeometryDifference(left[key], right[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
  );
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__!;
    const surface = (hook.getEditor() as DocxEditorInstance).surface!;
    const ids = surface.session.paragraphIds();
    if (ids.length > 20_000) throw new Error('Probe limit: 20,000 paragraphs');
    const paragraphs = ids.map((id) => ({ id, text: hook.benchmarkParagraphModelText(id) ?? '' }));
    if (paragraphs.reduce((total, item) => total + item.text.length, 0) > 4_000_000) {
      throw new Error('Probe limit: 4,000,000 text characters');
    }
    const layout = surface.layout();
    if (layout.pages.length > 1000) throw new Error('Probe limit: 1,000 pages');
    // Ignore revision and source IDs. Record geometry and visible text in document order.
    const keys = [
      'box',
      'contentBox',
      'baseline',
      'contentX',
      'leading',
      'trailingSpacing',
      'text',
      'fragments',
      'lines',
      'spans',
      'rows',
      'cells',
      'blocks',
      'header',
      'footer',
      'footnotes',
      'endnotes',
      'anchoredDrawings',
      'columnSeparators',
    ];
    const geometry = (value: unknown, depth = 0): unknown => {
      if (depth > 100) throw new Error('Probe limit: geometry depth');
      if (typeof value === 'number') return Math.round(value * 1000) / 1000;
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map((entry) => geometry(entry, depth + 1));
      const record = value as Record<string, unknown>;
      if ('x' in record && 'y' in record && 'width' in record) {
        return Object.fromEntries(
          ['x', 'y', 'width', 'height'].map((key) => [key, geometry(record[key], depth + 1)])
        );
      }
      return Object.fromEntries(
        keys.filter((key) => key in record).map((key) => [key, geometry(record[key], depth + 1)])
      );
    };
    return {
      paragraphs,
      fingerprint: hook.fingerprint(),
      geometry: JSON.stringify(layout.pages.map((item) => geometry(item))),
      pageCount: layout.pages.length,
    };
  });
}

async function runJob(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  baseUrl: string,
  job: Job,
  captureIdentity: Identity
) {
  const started = performance.now();
  const checks: Record<string, boolean> = {};
  const timings: Record<string, number> = {};
  const evidence: Record<string, string> = {};
  let stage = 'input';
  let sourceHash: string | null = null;
  let geometryHashes: { incremental: string; reopened: string } | null = null;
  let firstDifference: GeometryDifference | null = null;
  let target: { paragraphId: string; offset: number } | null = null;
  let change: {
    inserted: string;
    beforeTextHash: string;
    afterTextHash: string;
    beforeCharacters: number;
    afterCharacters: number;
    changedParagraphs: number;
  } | null = null;
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let page: Page | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const assert = (name: string, valid: boolean) => {
    checks[name] = valid;
    if (!valid) throw new Error(`Check failed: ${name}`);
  };
  const execute = async () => {
    if ((await stat(job.input)).size > MAX_BYTES)
      throw new Error('Probe limit: input exceeds 32 MiB');
    const bytes = await readFile(job.input);
    sourceHash = hash(bytes);
    stage = 'open';
    context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
    await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseUrl).origin) return route.abort('blockedbyclient');
      if (url.pathname.endsWith('/evaluation-input.docx')) {
        return route.fulfill({
          body: bytes,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      }
      return route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(`${baseUrl}/?e2e=1&fixture=evaluation-input.docx`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () =>
        window.__DOCX_EDITOR_E2E__?.ready() &&
        window.__DOCX_EDITOR_E2E__?.fontMeasurer() === 'shaped',
      undefined,
      { timeout: 45_000 }
    );
    await page.locator('.docx-page:not(.docx-editor__loading-page)').first().waitFor();
    await settle(page);
    const before = await snapshot(page);
    checks.open = true;
    timings.openMs = performance.now() - started;
    stage = 'pointer';
    const location = await page
      .locator('.docx-pages [data-paragraph-id][data-start]')
      .evaluateAll((nodes) => {
        for (const node of nodes) {
          if (node.closest('[data-docx-hf]') || !node.textContent?.trim()) continue;
          const rect = node.getBoundingClientRect();
          if (rect.width > 2 && rect.height > 2 && rect.top >= 0 && rect.bottom < innerHeight) {
            return {
              id: node.getAttribute('data-paragraph-id'),
              x: rect.left + Math.min(4, rect.width / 2),
              y: rect.top + rect.height / 2,
            };
          }
        }
        return null;
      });
    if (!location) throw new Error('No visible editable body text for this recipe');
    await page.mouse.click(location.x, location.y);
    const selection = await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.benchmarkSelection());
    assert(
      'pointerPlacement',
      !!selection &&
        selection.anchor.paragraphId === location.id &&
        selection.head.paragraphId === location.id &&
        selection.anchor.offset === selection.head.offset
    );
    target = selection!.anchor;
    const intended = before.paragraphs.find((paragraph) => paragraph.id === target!.paragraphId);
    assert('pointerTargetExists', !!intended);
    const expected = before.paragraphs.map((paragraph) => ({
      ...paragraph,
      text:
        paragraph.id === target!.paragraphId
          ? paragraph.text.slice(0, target!.offset) + 'Q' + paragraph.text.slice(target!.offset)
          : paragraph.text,
    }));
    // Layout text preserves model offsets but can project fields and non-text atoms.
    // Compare the edit against that projection, while checking canonical text separately.
    const beforeVisibleText = await page.evaluate(
      (id) => window.__DOCX_EDITOR_E2E__!.benchmarkParagraphText(id),
      target.paragraphId
    );
    if (beforeVisibleText === null || target.offset > beforeVisibleText.length)
      throw new Error('The selected position has no layout-text projection');
    const expectedVisibleText =
      beforeVisibleText.slice(0, target.offset) + 'Q' + beforeVisibleText.slice(target.offset);
    stage = 'editAdmission';
    const admission = await page.evaluate(() =>
      window.__DOCX_EDITOR_E2E__!.can({ type: 'insertText', text: 'Q' })
    );
    if (!admission.ok)
      throw new Error(`Edit recipe refused (${admission.code}): ${admission.reason}`);
    stage = 'insert';
    const editStart = performance.now();
    await page.keyboard.type('Q');
    await settle(page);
    const edited = await snapshot(page);
    change = {
      inserted: 'Q',
      beforeTextHash: hash(JSON.stringify(before.paragraphs)),
      afterTextHash: hash(JSON.stringify(edited.paragraphs)),
      beforeCharacters: before.paragraphs.reduce((total, item) => total + item.text.length, 0),
      afterCharacters: edited.paragraphs.reduce((total, item) => total + item.text.length, 0),
      changedParagraphs: edited.paragraphs.filter(
        (item, index) => item.text !== before.paragraphs[index]?.text
      ).length,
    };
    assert('intendedTextOnly', JSON.stringify(edited.paragraphs) === JSON.stringify(expected));
    const visibleText = await page.evaluate(
      (id) => window.__DOCX_EDITOR_E2E__!.benchmarkParagraphText(id),
      target.paragraphId
    );
    assert('layoutUpdated', visibleText === expectedVisibleText);
    timings.insertMs = performance.now() - editStart;
    stage = 'undo';
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    const undone = await snapshot(page);
    assert('undoText', JSON.stringify(undone.paragraphs) === JSON.stringify(before.paragraphs));
    assert('undoStructure', undone.fingerprint === before.fingerprint);
    stage = 'redo';
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await settle(page);
    const redone = await snapshot(page);
    assert('redoText', JSON.stringify(redone.paragraphs) === JSON.stringify(expected));
    stage = 'saveReopen';
    const saved = await page.evaluate(async () => {
      const hook = window.__DOCX_EDITOR_E2E__!;
      const savedBytes = await hook.saveBytes();
      if (!savedBytes) throw new Error('Save returned no bytes');
      await hook
        .getEditor()!
        .load(
          savedBytes.buffer.slice(
            savedBytes.byteOffset,
            savedBytes.byteOffset + savedBytes.byteLength
          ) as ArrayBuffer
        );
      return Array.from(savedBytes);
    });
    await settle(page);
    const reopened = await snapshot(page);
    assert(
      'savedTextPreserved',
      JSON.stringify(reopened.paragraphs.map((paragraph) => paragraph.text)) ===
        JSON.stringify(expected.map((paragraph) => paragraph.text))
    );
    const differences = await page.evaluate(
      (values) => window.__DOCX_EDITOR_E2E__!.semanticDigestDiff(new Uint8Array(values)),
      saved
    );
    assert('savedBodyStructurePreserved', differences !== null && differences.length === 0);
    geometryHashes = { incremental: hash(redone.geometry), reopened: hash(reopened.geometry) };
    if (geometryHashes.incremental !== geometryHashes.reopened)
      firstDifference = firstGeometryDifference(
        JSON.parse(redone.geometry),
        JSON.parse(reopened.geometry)
      );
    assert('incrementalMatchesReopen', geometryHashes.incremental === geometryHashes.reopened);
    checks.complete = true;
  };
  let failure: { stage: string; message: string } | null = null;
  try {
    await Promise.race([
      execute(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Probe exceeded ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    failure = { stage, message: error instanceof Error ? error.message : String(error) };
    const dir = resolve(job.artifacts ?? `${job.output}.artifacts`);
    await mkdir(dir, { recursive: true });
    if (page && !page.isClosed()) {
      const screenshot = resolve(dir, 'failure.png');
      try {
        await page.screenshot({ path: screenshot, timeout: 3000 });
        evidence.screenshot = screenshot;
      } catch {
        /* A crashed renderer cannot capture. */
      }
    }
    if (context) {
      const trace = resolve(dir, 'trace.zip');
      try {
        await context.tracing.stop({ path: trace });
        evidence.trace = trace;
      } catch {
        /* A crashed renderer cannot capture. */
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
    await context?.close();
  }
  timings.totalMs = performance.now() - started;
  const result = {
    protocol: 1,
    level: 'L3',
    recipe: RECIPE,
    status: failure ? (Object.values(checks).includes(false) ? 'failed' : 'blocked') : 'passed',
    sourceHash,
    identity: captureIdentity,
    checks,
    target,
    change,
    geometryHashes,
    firstDifference,
    timings,
    failure,
    evidence,
    coverage: {
      pointer: checks.pointerPlacement === true,
      insert: checks.intendedTextOnly === true,
      undo: checks.undoStructure === true,
      redo: checks.redoText === true,
      saveReopen: checks.savedBodyStructurePreserved === true,
      incrementalLayout: checks.incrementalMatchesReopen === true,
      dragSelection: false,
      format: false,
      externalReference: false,
    },
  };
  await mkdir(dirname(resolve(job.output)), { recursive: true });
  await writeFile(job.output, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--identity') {
    emit(JSON.stringify(await identity()));
    return;
  }
  if (args.includes('--help')) {
    emit(
      'bun e2e/evaluation-browser.ts --input INPUT.docx --output RESULT.json [--base-url http://127.0.0.1:5273] [--artifacts DIR] [--build-dir CACHE_DIR]\nBatch: --manifest jobs.json (array of {input, output, artifacts?}; maximum 100).\nIdentity: --identity (recipe, browser executable, font assets, viewport, runtime).'
    );
    return;
  }
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (
      !['--input', '--output', '--artifacts', '--manifest', '--base-url', '--build-dir'].includes(
        args[index]!
      ) ||
      !args[index + 1]
    )
      throw new Error('Unknown or incomplete argument. Use --help.');
    options.set(args[index]!, args[index + 1]!);
  }
  const jobs: Job[] = options.has('--manifest')
    ? JSON.parse(await readFile(options.get('--manifest')!, 'utf8'))
    : [
        {
          input: options.get('--input')!,
          output: options.get('--output')!,
          artifacts: options.get('--artifacts'),
        },
      ];
  if (
    !Array.isArray(jobs) ||
    !jobs.length ||
    jobs.length > 100 ||
    jobs.some((job) => !job || typeof job.input !== 'string' || typeof job.output !== 'string')
  )
    throw new Error('Provide 1–100 jobs with input and output paths. Use --help.');
  for (const job of jobs) {
    if (!job.output.endsWith('.json') || resolve(job.input) === resolve(job.output))
      throw new Error('Each output must be a separate .json path.');
    if (job.artifacts !== undefined && typeof job.artifacts !== 'string')
      throw new Error('Artifacts must be a directory path.');
  }
  let server: Awaited<ReturnType<typeof staticHarness>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const supplied = options.get('--base-url');
  let baseUrl = supplied ?? 'http://127.0.0.1';
  const url = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:')
    throw new Error('The browser harness must use a local HTTP server.');
  try {
    if (!supplied) {
      server = await staticHarness(options.get('--build-dir'));
      baseUrl = server.url;
    }
    const captureIdentity = await identity();
    gc(true);
    for (const job of jobs) {
      browser = await chromium.launch({
        headless: true,
        executablePath: await browserExecutable(),
        args: ['--js-flags=--max-old-space-size=192'],
      });
      const result = await runJob(browser, baseUrl, job, captureIdentity);
      emit(
        JSON.stringify({
          output: resolve(job.output),
          status: result.status,
          elapsedMs: result.timings.totalMs,
        })
      );
      if (result.status !== 'passed') process.exitCode = 1;
      await browser.close();
      browser = undefined;
      gc(true);
    }
  } finally {
    await browser?.close();
    await server?.stop();
  }
}
await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
