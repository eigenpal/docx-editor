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
  DEFAULT_GLOBAL_DEADLINE_MS,
  buildProfileReport,
  evaluateTypingRun,
  formatStructuredInvalid,
  formatTypingAuditReport,
  installTypingAuditProbeInPage,
  parseTypingUrlAuditArgs,
  quantile,
  requireRemainingMs,
  resolveTargetParagraphId,
  summarizeResponsiveness,
  typingUrlAuditHelpText,
  validateAuditUrl,
  validateHttpUrlPolicy,
  validateTypingProbeSample,
  waitForPaintedPageCountStable,
  waitForPerfE2EBridge,
} from './typing-url-audit-lib.mjs';

const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  process.stdout.write(typingUrlAuditHelpText());
  process.exit(0);
}

/** @type {import('./typing-url-audit-lib.mjs').TypingUrlAuditArgs} */
let args;
try {
  args = parseTypingUrlAuditArgs(argv);
} catch (error) {
  process.stdout.write(
    formatStructuredInvalid({
      valid: false,
      reasons: [],
      detail: error instanceof Error ? error.message : String(error),
    })
  );
  process.stdout.write('\n');
  process.exit(1);
}

const deadlineAt = Date.now() + (args.globalDeadlineMs ?? DEFAULT_GLOBAL_DEADLINE_MS);

/** @type {{ type: string; text: string }[]} */
const consoleEvents = [];
/** @type {string[]} */
const pageErrors = [];
/** @type {{ url: string; failure: string }[]} */
const requestFailures = [];

class AuditFailure extends Error {}

let invalidPrinted = false;

/**
 * @param {{ detail: string; reasons?: string[] }} input
 */
function fail(input) {
  if (!invalidPrinted) {
    process.stdout.write(
      formatStructuredInvalid({
        valid: false,
        reasons: input.reasons ?? [],
        detail: input.detail,
        consoleErrors: consoleEvents,
        pageErrors,
        requestFailures,
      })
    );
    process.stdout.write('\n');
    invalidPrinted = true;
  }
  throw new AuditFailure(input.detail);
}

/** @type {import('@playwright/test').Browser | null} */
let browser = null;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let rejectFatalPageError = () => {};
  const fatalPageError = new Promise((_, reject) => {
    rejectFatalPageError = reject;
  });

  page.on('console', (message) => {
    consoleEvents.push({ type: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
    rejectFatalPageError(error);
  });
  page.on('requestfailed', (request) => {
    requestFailures.push({
      url: request.url(),
      failure: request.failure()?.errorText ?? 'request failed',
    });
  });

  if (!args.allowRemote) {
    await page.route('**/*', (route) => {
      const policy = validateHttpUrlPolicy(route.request().url(), {
        allowRemote: args.allowRemote,
      });
      if (!policy.allowed) {
        requestFailures.push({
          url: route.request().url(),
          failure: 'blocked non-loopback http(s) request',
        });
        void route.abort('blockedbyclient');
        return;
      }
      void route.continue();
    });
  }

  const gotoTimeout = requireRemainingMs(deadlineAt, {
    label: 'navigation',
    globalDeadlineMs: args.globalDeadlineMs,
  });
  await Promise.race([
    page.goto(args.url, { waitUntil: 'networkidle', timeout: gotoTimeout }),
    fatalPageError,
  ]);

  const landed = validateHttpUrlPolicy(page.url(), { allowRemote: args.allowRemote });
  if (!landed.allowed) {
    fail({
      detail: `navigation landed on non-loopback URL ${page.url()}`,
    });
  }
  validateAuditUrl(page.url(), { allowRemote: args.allowRemote });

  if (pageErrors.length > 0) {
    fail({ detail: 'page error during navigation', reasons: pageErrors.map((error) => error) });
  }

  await waitForPaintedPageCountStable(page, { deadlineAt });
  await waitForPerfE2EBridge(page, { deadlineAt });
  await page.waitForFunction(
    () => {
      const pages = document.querySelector('.docx-pages');
      if (!pages) return false;
      const raw = pages.getAttribute('data-revision');
      return raw !== null && Number.isFinite(Number(raw));
    },
    { timeout: requireRemainingMs(deadlineAt, { label: 'wait for layout revision marker' }) }
  );
  await page.waitForTimeout(
    Math.min(5000, requireRemainingMs(deadlineAt, { label: 'post-load settle' }))
  );

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

  let targetParagraphId = null;
  if (args.paragraphIndex !== null) {
    targetParagraphId = await page.evaluate((index) => {
      return (
        document
          .querySelectorAll('[data-paragraph-id]')
          [index]?.getAttribute('data-paragraph-id') ?? null
      );
    }, args.paragraphIndex);
  } else {
    targetParagraphId = await resolveTargetParagraphId(
      page,
      args.targetParagraphContentMarker,
      args.targetParagraphNodeId
    );
  }

  if (!targetParagraphId) {
    fail({
      detail: 'target paragraph could not be resolved from the manifest marker or index',
    });
  }

  const paragraph = page.locator(`[data-paragraph-id="${targetParagraphId}"]`).first();
  await paragraph.click();
  await page.waitForTimeout(
    Math.min(1000, requireRemainingMs(deadlineAt, { label: 'caret settle after click' }))
  );

  const readModelText = () =>
    page.evaluate((paragraphId) => {
      return globalThis.__DOCX_EDITOR_E2E__?.benchmarkParagraphModelText?.(paragraphId) ?? null;
    }, targetParagraphId);

  const paintedStateOf = () =>
    page.evaluate((paragraphId) => {
      if (!paragraphId) return { maxEnd: -1, paintedText: '', paintedOffset: null };
      const selection = document.getSelection?.();
      const anchorNode = selection?.anchorNode ?? null;
      const anchorOffset = selection?.anchorOffset ?? 0;
      const activeSpan =
        anchorNode &&
        (anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode)?.closest(
          '[data-paragraph-id]'
        );
      const fragment = activeSpan?.closest('.docx-paragraph-fragment');
      if (!fragment) return { maxEnd: -1, paintedText: '', paintedOffset: null };
      const paintedText = fragment.textContent ?? '';
      let maxEnd = 0;
      for (const span of fragment.querySelectorAll('[data-paragraph-id]')) {
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
      let paintedOffset = null;
      if (anchorNode && fragment.contains(anchorNode)) {
        const pre = document.createRange();
        pre.selectNodeContents(fragment);
        pre.setEnd(anchorNode, anchorOffset);
        paintedOffset = pre.toString().length;
      }
      return { maxEnd, paintedText, paintedOffset };
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

  const beforePainted = await paintedStateOf();
  const before = beforePainted.maxEnd;
  const modelTextBefore = await readModelText();
  const caretOffsetBefore = await readCaret();
  const paintedInsertionOffset = beforePainted.paintedOffset ?? caretOffsetBefore?.offset ?? null;

  const samples = [];
  const perKeyGrowth = [];
  const perKeyRevisionAdvance = [];
  /** @type {import('./typing-url-audit-lib.mjs').TypingAuditProbeSample[]} */
  const probeSamples = [];
  /** @type {import('playwright-core').Protocol.Profiler.Profile[]} */
  const profileWindows = [];

  // The buffered responsiveness observers also capture the document open; everything
  // before this stamp is load work, not typing.
  const typingStartedAtMs = await page.evaluate(() => performance.now());

  for (let index = 0; index < args.keys; index += 1) {
    requireRemainingMs(deadlineAt, {
      label: `keystroke ${index + 1}`,
      globalDeadlineMs: args.globalDeadlineMs,
    });
    const lengthBeforeKey = (await paintedStateOf()).maxEnd;

    /** @type {import('playwright-core').CDPSession | null} */
    let profileClient = null;
    if (args.profile) {
      profileClient = await page.context().newCDPSession(page);
      await profileClient.send('Profiler.enable');
      await profileClient.send('Profiler.setSamplingInterval', { interval: 200 });
      await profileClient.send('Profiler.start');
    }

    await Promise.race([page.keyboard.type('x', { delay: 0 }), fatalPageError]);
    await page.waitForFunction(
      (expectedCount) => (globalThis.__typingAuditProbe?.samples?.length ?? 0) >= expectedCount,
      index + 1,
      {
        timeout: requireRemainingMs(deadlineAt, {
          label: `probe sample ${index + 1}`,
          globalDeadlineMs: args.globalDeadlineMs,
        }),
      }
    );
    const sample = await page.evaluate(
      (sampleIndex) => globalThis.__typingAuditProbe?.samples?.[sampleIndex] ?? null,
      index
    );

    if (args.profile && profileClient) {
      profileWindows.push((await profileClient.send('Profiler.stop')).profile);
      await profileClient.detach();
    }

    if (!validateTypingProbeSample(sample)) {
      fail({ detail: `invalid probe sample for keystroke ${index + 1}` });
    }
    samples.push(sample.ms);
    probeSamples.push(sample);
    perKeyRevisionAdvance.push(true);
    await page.waitForTimeout(
      Math.min(
        args.settleMs,
        requireRemainingMs(deadlineAt, {
          label: `post-keystroke settle ${index + 1}`,
          globalDeadlineMs: args.globalDeadlineMs,
        })
      )
    );
    const afterKeyPainted = await paintedStateOf();
    perKeyGrowth.push(afterKeyPainted.maxEnd - lengthBeforeKey);
  }

  const afterPainted = await paintedStateOf();
  const after = afterPainted.maxEnd;
  const modelTextAfter = await readModelText();
  const caretOffsetAfter = await readCaret();
  const trustedBeforeInputCount = await page.evaluate(
    () => globalThis.__typingAuditProbe?.trustedBeforeInputs ?? 0
  );
  const responsivenessRaw = await page.evaluate(() => ({
    slowInputEvents: globalThis.__typingAuditProbe?.slowInputEvents ?? [],
    longTasks: globalThis.__typingAuditProbe?.longTasks ?? [],
    observerSupport: globalThis.__typingAuditProbe?.observerSupport ?? {
      eventTiming: false,
      longTask: false,
    },
  }));
  // Empty lists are an all-clear only when an observer actually installed; with neither
  // API supported the section is omitted rather than claiming the run was jank-free.
  const responsiveness =
    responsivenessRaw.observerSupport.eventTiming || responsivenessRaw.observerSupport.longTask
      ? summarizeResponsiveness(
          responsivenessRaw.slowInputEvents.filter(
            (event) => event.startTimeMs >= typingStartedAtMs
          ),
          responsivenessRaw.longTasks
            .filter((task) => task.startTimeMs >= typingStartedAtMs)
            .map((task) => task.durationMs)
        )
      : undefined;

  const caretInPagesLayer = await page.evaluate(() => {
    const pages = document.querySelector('.docx-pages');
    const active = document.activeElement;
    return Boolean(pages && active && pages.contains(active));
  });

  const layoutRevisionAfter = await readRevision();

  const verdict = evaluateTypingRun({
    pages: opened.pages,
    expectedPages: args.minPages ?? opened.pages,
    beforeLength: before,
    afterLength: after,
    beforeModelLength: modelTextBefore?.length ?? null,
    afterModelLength: modelTextAfter?.length ?? null,
    keys: args.keys,
    layoutRevisionBefore,
    layoutRevisionAfter,
    caretInPagesLayer,
    consoleErrors: consoleEvents,
    pageErrors,
    requestFailures,
    perKeyGrowth,
    trustedBeforeInputCount,
    perKeyRevisionAdvance,
    probeSamples,
    caretOffsetBefore,
    caretOffsetAfter,
    expectedCaretParagraphId: targetParagraphId,
    modelTextBefore,
    modelTextAfter,
    paintedTextBefore: beforePainted.paintedText,
    paintedTextAfter: afterPainted.paintedText,
    insertionOffset: caretOffsetBefore?.offset ?? null,
    paintedInsertionOffset,
  });

  const sorted = [...samples].sort((a, b) => a - b);
  const profileReport =
    verdict.valid && args.profile ? buildProfileReport(profileWindows, args.keys, args.top) : null;

  process.stdout.write(
    formatTypingAuditReport(verdict, args, {
      url: args.url,
      opened,
      beforeLength: before,
      afterLength: after,
      beforeModelLength: modelTextBefore?.length,
      afterModelLength: modelTextAfter?.length,
      sortedSamples: sorted,
      consoleErrors: consoleEvents,
      pageErrors,
      requestFailures,
      profileLines: profileReport?.lines,
      responsiveness,
      trustedBeforeInputCount,
      caretOffsetBefore,
      caretOffsetAfter,
      targetParagraphId,
    })
  );
  process.stdout.write('\n');

  if (!verdict.valid || (profileReport && !profileReport.valid)) {
    process.exitCode = 1;
  }
} catch (error) {
  if (!(error instanceof AuditFailure)) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!invalidPrinted) {
      process.stdout.write(
        formatStructuredInvalid({
          valid: false,
          reasons: [],
          detail,
          consoleErrors: consoleEvents,
          pageErrors,
          requestFailures,
        })
      );
      process.stdout.write('\n');
    }
  }
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
}

void quantile;
