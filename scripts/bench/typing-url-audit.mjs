#!/usr/bin/env bun
/**
 * Audit typing latency against a running dev server, through the real demo UI.
 *
 * Usage:
 *   bun run dev                       # in another terminal, serves :5173
 *   bun scripts/bench/typing-url-audit.mjs
 *
 * A run prints VALID only when structural evidence passes. Latency metrics are omitted for
 * INVALID runs, which exit non-zero.
 */

import { chromium } from '@playwright/test';
import {
  caretOffsetFromDom,
  evaluateTypingRun,
  formatTypingAuditReport,
  installTypingAuditProbeInPage,
  layoutRevisionOf,
  parseTypingUrlAuditArgs,
  quantile,
  typingUrlAuditHelpText,
  validateTypingProbeSample,
  waitForPaintedPageCountStable,
} from './typing-url-audit-lib.mjs';

const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  process.stdout.write(typingUrlAuditHelpText());
  process.exit(0);
}

const args = parseTypingUrlAuditArgs(argv);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
const pageErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
});
page.on('pageerror', (error) => {
  pageErrors.push(String(error).slice(0, 200));
});

try {
  await page.goto(args.url, { waitUntil: 'networkidle', timeout: 180000 });
  await waitForPaintedPageCountStable(page);
  await page.waitForFunction(() => {
    const pages = document.querySelector('.docx-pages');
    if (!pages) return false;
    const raw = pages.getAttribute('data-revision');
    return raw !== null && Number.isFinite(Number(raw));
  });
  await page.waitForTimeout(5000);

  const opened = await page.evaluate(() => ({
    pages: document.querySelectorAll('[data-page-index]').length,
    paragraphs: document.querySelectorAll('[data-paragraph-id]').length,
  }));

  const layoutRevisionBefore = await page.evaluate(() => {
    const pages = document.querySelector('.docx-pages');
    if (!pages) return null;
    const raw = pages.getAttribute('data-revision');
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });

  await page.evaluate(installTypingAuditProbeInPage);

  const paragraph = page.locator('[data-paragraph-id]').nth(args.paragraphIndex);
  await paragraph.click();
  await page.waitForTimeout(1000);

  const targetParagraphId = await page.evaluate((index) => {
    return (
      document.querySelectorAll('[data-paragraph-id]')[index]?.getAttribute('data-paragraph-id') ??
      null
    );
  }, args.paragraphIndex);

  const lengthOf = () =>
    page.evaluate((paragraphId) => {
      if (!paragraphId) return -1;
      let maxEnd = 0;
      for (const span of document.querySelectorAll('[data-paragraph-id]')) {
        if (span.getAttribute('data-paragraph-id') !== paragraphId) continue;
        const rawEnd = span.getAttribute('data-end');
        if (rawEnd !== null && /^\d{1,9}$/.test(rawEnd)) {
          maxEnd = Math.max(maxEnd, Number(rawEnd));
          continue;
        }
        const rawStart = span.getAttribute('data-start');
        const start = rawStart !== null && /^\d{1,9}$/.test(rawStart) ? Number(rawStart) : 0;
        maxEnd = Math.max(maxEnd, start + (span.textContent?.length ?? 0));
      }
      return maxEnd;
    }, targetParagraphId);

  const readRevision = () =>
    page.evaluate(() => {
      const pages = document.querySelector('.docx-pages');
      if (!pages) return null;
      const raw = pages.getAttribute('data-revision');
      if (raw === null) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    });

  const readCaret = () =>
    page.evaluate(() => {
      const pages = document.querySelector('.docx-pages');
      if (!pages) return null;
      const selection = document.getSelection?.();
      if (!selection || selection.rangeCount === 0) return null;
      const { anchorNode, anchorOffset } = selection;
      if (!anchorNode || !pages.contains(anchorNode)) return null;
      const element =
        anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement;
      if (!element) return null;
      const span = element.closest('[data-paragraph-id][data-start]');
      if (!span) return null;
      const paragraphId = span.getAttribute('data-paragraph-id');
      const rawStart = span.getAttribute('data-start');
      if (!paragraphId || rawStart === null || !/^\d{1,9}$/.test(rawStart)) return null;
      const start = Number(rawStart);
      const rawEnd = span.getAttribute('data-end');
      const end =
        rawEnd !== null && /^\d{1,9}$/.test(rawEnd) && Number(rawEnd) >= start
          ? Number(rawEnd)
          : start + (span.textContent?.length ?? 0);
      const within =
        anchorNode.nodeType === Node.TEXT_NODE
          ? Math.max(0, Math.min(anchorOffset, end - start))
          : anchorOffset > 0
            ? end - start
            : 0;
      return { paragraphId, offset: start + within };
    });

  const before = await lengthOf();
  const caretOffsetBefore = await readCaret();
  if (!targetParagraphId) {
    throw new Error(
      `paragraph index ${args.paragraphIndex} did not resolve to a painted paragraph id`
    );
  }

  const client = await page.context().newCDPSession(page);
  if (args.profile) {
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 200 });
    await client.send('Profiler.start');
  }

  const samples = [];
  const perKeyGrowth = [];
  const perKeyRevisionAdvance = [];
  for (let index = 0; index < args.keys; index += 1) {
    const lengthBeforeKey = await lengthOf();
    await page.keyboard.type('x', { delay: 0 });
    await page.waitForFunction(
      (expectedCount) => (globalThis.__typingAuditProbe?.samples?.length ?? 0) >= expectedCount,
      index + 1,
      { timeout: 30000 }
    );
    const sample = await page.evaluate(
      (sampleIndex) => globalThis.__typingAuditProbe?.samples?.[sampleIndex] ?? null,
      index
    );
    if (!validateTypingProbeSample(sample)) {
      throw new Error(`invalid probe sample for keystroke ${index + 1}`);
    }
    samples.push(sample.ms);
    perKeyRevisionAdvance.push(true);
    await page.waitForTimeout(args.settleMs);
    const lengthAfterKey = await lengthOf();
    perKeyGrowth.push(lengthAfterKey - lengthBeforeKey);
  }

  const probeSamples = await page.evaluate(() => globalThis.__typingAuditProbe?.samples ?? []);

  const profile = args.profile ? (await client.send('Profiler.stop')).profile : null;
  const after = await lengthOf();
  const caretOffsetAfter = await readCaret();
  const trustedBeforeInputCount = await page.evaluate(
    () => globalThis.__typingAuditProbe?.trustedBeforeInputs ?? 0
  );

  const caretInPagesLayer = await page.evaluate(() => {
    const pages = document.querySelector('.docx-pages');
    const active = document.activeElement;
    return Boolean(pages && active && pages.contains(active));
  });

  const layoutRevisionAfter = await readRevision();

  const verdict = evaluateTypingRun({
    pages: opened.pages,
    minPages: args.minPages,
    beforeLength: before,
    afterLength: after,
    keys: args.keys,
    layoutRevisionBefore,
    layoutRevisionAfter,
    caretInPagesLayer,
    consoleErrors,
    pageErrors,
    perKeyGrowth,
    trustedBeforeInputCount,
    perKeyRevisionAdvance,
    probeSamples,
    caretOffsetBefore,
    caretOffsetAfter,
    expectedCaretParagraphId: targetParagraphId,
  });

  const sorted = [...samples].sort((a, b) => a - b);
  /** @type {string[]} */
  const profileLines = [];
  if (verdict.valid && profile) {
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const deltas = profile.timeDeltas ?? [];
    const selfTime = new Map();
    for (let index = 0; index < profile.samples.length; index += 1) {
      const id = profile.samples[index];
      selfTime.set(id, (selfTime.get(id) ?? 0) + Math.max(deltas[index] ?? 0, 0));
    }
    const byFunction = new Map();
    let idle = 0;
    for (const [id, micros] of selfTime) {
      const node = nodes.get(id);
      if (!node) continue;
      const frame = node.callFrame;
      const name = frame.functionName || '(anonymous)';
      if (name === '(idle)' || name === '(program)') {
        idle += micros;
        continue;
      }
      const file = (frame.url || '').split('/').pop()?.split('?')[0] ?? '';
      const key = `${name}|${file}:${frame.lineNumber + 1}`;
      byFunction.set(key, (byFunction.get(key) ?? 0) + micros);
    }
    const ranked = [...byFunction.entries()].sort((a, b) => b[1] - a[1]);
    const active = ranked.reduce((sum, [, micros]) => sum + micros, 0);
    profileLines.push(
      `\nCPU: ${(active / 1000 / args.keys).toFixed(1)} ms/key active, ` +
        `${(idle / 1000 / args.keys).toFixed(1)} ms/key idle or program`
    );
    profileLines.push(`${'ms/key'.padStart(8)}  ${'%'.padStart(5)}  function (file:line)`);
    for (const [key, micros] of ranked.slice(0, args.top)) {
      const [name, where] = key.split('|');
      profileLines.push(
        `${(micros / 1000 / args.keys).toFixed(2).padStart(8)}  ` +
          `${((100 * micros) / active).toFixed(1).padStart(5)}  ${name} (${where})`
      );
    }
  }

  process.stdout.write(
    formatTypingAuditReport(verdict, args, {
      url: args.url,
      opened,
      beforeLength: before,
      afterLength: after,
      sortedSamples: sorted,
      consoleErrors,
      pageErrors,
      profileLines,
      trustedBeforeInputCount,
      caretOffsetBefore,
      caretOffsetAfter,
    })
  );
  process.stdout.write('\n');

  if (!verdict.valid) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

// Keep quantile exported for tests that import this module indirectly.
void quantile;
void layoutRevisionOf;
void caretOffsetFromDom;
