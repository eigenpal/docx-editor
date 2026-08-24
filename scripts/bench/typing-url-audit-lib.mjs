/**
 * Pure helpers for `typing-url-audit.mjs` — parser, validation, and run verdict logic.
 * Unit-tested without a browser.
 */

export const DEFAULT_FIXTURE = 'typing-perf-521pp.docx';
export const DEFAULT_MIN_PAGES = 521;

const MAX_KEYS = 10_000;
const MAX_SETTLE_MS = 60_000;
const MAX_TOP = 500;
const MAX_PARAGRAPH_INDEX = 1_000_000;
const MAX_MIN_PAGES = 100_000;

/** @typedef {{
 *   fixture: string;
 *   keys: number;
 *   url: string | null;
 *   minPages: number;
 *   paragraphIndex: number;
 *   settleMs: number;
 *   profile: boolean;
 *   top: number;
 * }} TypingUrlAuditArgs */

/**
 * @param {unknown} value
 * @param {{ min?: number; max?: number; integer?: boolean; label: string }} bounds
 */
export function parseBoundedNumber(
  value,
  { min = 1, max = Number.MAX_SAFE_INTEGER, integer = true, label }
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (integer && !Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return parsed;
}

/**
 * @param {readonly string[]} argv
 * @returns {TypingUrlAuditArgs}
 */
export function parseTypingUrlAuditArgs(argv) {
  /** @type {TypingUrlAuditArgs} */
  const out = {
    fixture: DEFAULT_FIXTURE,
    keys: 12,
    url: null,
    minPages: DEFAULT_MIN_PAGES,
    paragraphIndex: 8,
    settleMs: 250,
    profile: true,
    top: 30,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--fixture') {
      if (typeof value !== 'string' || value.length === 0)
        throw new Error('--fixture requires a value');
      out.fixture = value;
      index += 1;
    } else if (flag === '--keys') {
      out.keys = parseBoundedNumber(value, { min: 1, max: MAX_KEYS, label: '--keys' });
      index += 1;
    } else if (flag === '--url') {
      if (typeof value !== 'string' || value.length === 0)
        throw new Error('--url requires a value');
      out.url = value;
      index += 1;
    } else if (flag === '--min-pages') {
      out.minPages = parseBoundedNumber(value, {
        min: 1,
        max: MAX_MIN_PAGES,
        label: '--min-pages',
      });
      index += 1;
    } else if (flag === '--paragraph') {
      out.paragraphIndex = parseBoundedNumber(value, {
        min: 0,
        max: MAX_PARAGRAPH_INDEX,
        label: '--paragraph',
      });
      index += 1;
    } else if (flag === '--settle') {
      out.settleMs = parseBoundedNumber(value, {
        min: 0,
        max: MAX_SETTLE_MS,
        integer: false,
        label: '--settle',
      });
      index += 1;
    } else if (flag === '--top') {
      out.top = parseBoundedNumber(value, { min: 1, max: MAX_TOP, label: '--top' });
      index += 1;
    } else if (flag === '--no-profile') {
      out.profile = false;
    } else if (flag === '--help') {
      return out;
    } else {
      throw new Error(`unknown flag ${flag}`);
    }
  }
  out.url ??= `http://localhost:5173/?fixture=${out.fixture}`;
  return out;
}

/** @param {readonly number[]} sorted */
export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * @param {readonly string[]} consoleErrors
 */
export function hasEditorRelatedConsoleErrors(consoleErrors) {
  return consoleErrors.some((message) =>
    /docx-editor|@docx-editor|paginated-surface|semantic-layout|tree-session|engine|layout|paint/i.test(
      message
    )
  );
}

/**
 * @param {readonly string[]} consoleErrors
 * @param {readonly string[]} pageErrors
 */
export function hasEditorRelatedErrors(consoleErrors, pageErrors) {
  return hasEditorRelatedConsoleErrors(consoleErrors) || pageErrors.length > 0;
}

/** @typedef {{ startMs: number; revisionBefore: number | null }} TypingAuditPendingSample */
/** @typedef {{ ms: number; revisionBefore: number | null; revisionAfter: number | null }} TypingAuditProbeSample */

/**
 * @param {unknown} sample
 */
export function validateTypingProbeSample(sample) {
  if (!sample || typeof sample !== 'object') return false;
  const record = /** @type {TypingAuditProbeSample} */ (sample);
  if (typeof record.ms !== 'number' || !Number.isFinite(record.ms) || record.ms < 0) {
    return false;
  }
  if (
    record.revisionBefore === null ||
    record.revisionAfter === null ||
    !Number.isFinite(record.revisionBefore) ||
    !Number.isFinite(record.revisionAfter)
  ) {
    return false;
  }
  return record.revisionAfter > record.revisionBefore;
}

/**
 * @param {readonly TypingAuditProbeSample[]} samples
 * @param {number} keys
 */
export function validateTypingProbeSamples(samples, keys) {
  if (samples.length !== keys) return false;
  return samples.every((sample) => validateTypingProbeSample(sample));
}

/**
 * Browser-side typing probe: trusted beforeinput starts the timer; a layout revision
 * mutation finishes it on the next animation frame.
 */
export function installTypingAuditProbeInPage() {
  /** @type {{ trustedBeforeInputs: number; pendingSample: TypingAuditPendingSample | null; samples: TypingAuditProbeSample[] }} */
  const probe = { trustedBeforeInputs: 0, pendingSample: null, samples: [] };
  globalThis.__typingAuditProbe = probe;

  const readRevision = () => {
    const pages = document.querySelector('.docx-pages');
    if (!pages) return null;
    const raw = pages.getAttribute('data-revision');
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  document.addEventListener(
    'beforeinput',
    (event) => {
      if (!event.isTrusted) return;
      probe.trustedBeforeInputs += 1;
      probe.pendingSample = {
        startMs: performance.now(),
        revisionBefore: readRevision(),
      };
    },
    true
  );

  const pages = document.querySelector('.docx-pages');
  if (pages) {
    new MutationObserver(() => {
      if (!probe.pendingSample) return;
      const revisionAfter = readRevision();
      if (
        revisionAfter === null ||
        probe.pendingSample.revisionBefore === null ||
        revisionAfter <= probe.pendingSample.revisionBefore
      ) {
        return;
      }
      const pending = probe.pendingSample;
      probe.pendingSample = null;
      requestAnimationFrame(() => {
        probe.samples.push({
          ms: performance.now() - pending.startMs,
          revisionBefore: pending.revisionBefore,
          revisionAfter,
        });
      });
    }).observe(pages, { attributes: true, attributeFilter: ['data-revision'] });
  }

  return probe;
}

/**
 * Read layout revision from the painted pages container.
 *
 * @param {Document | Element} root
 */
export function layoutRevisionOf(root) {
  const pages = root.querySelector('.docx-pages');
  if (!pages) return null;
  const raw = pages.getAttribute('data-revision');
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Collapsed caret offset from painted span markers, when the native selection resolves.
 *
 * @param {Document} document
 * @param {Element} pagesRoot
 */
export function caretOffsetFromDom(document, pagesRoot) {
  const selection = document.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const { anchorNode, anchorOffset } = selection;
  if (!anchorNode || !pagesRoot.contains(anchorNode)) return null;
  const element = anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement;
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
}

/**
 * @param {{
 *   pages: number;
 *   minPages: number;
 *   beforeLength: number;
 *   afterLength: number;
 *   keys: number;
 *   layoutRevisionBefore: number | null;
 *   layoutRevisionAfter: number | null;
 *   caretInPagesLayer: boolean;
 *   consoleErrors: readonly string[];
 *   pageErrors: readonly string[];
 *   perKeyGrowth?: readonly number[];
 *   trustedBeforeInputCount?: number;
 *   perKeyRevisionAdvance?: readonly boolean[];
 *   caretOffsetBefore?: { paragraphId: string; offset: number } | null;
 *   caretOffsetAfter?: { paragraphId: string; offset: number } | null;
 *   expectedCaretParagraphId?: string | null;
 *   probeSamples?: readonly { ms: number; revisionBefore: number | null; revisionAfter: number | null }[];
 * }} input
 */
export function evaluateTypingRun(input) {
  const reasons = [];
  const paragraphGrowth = input.afterLength - input.beforeLength;
  const keysLanded = paragraphGrowth === input.keys;

  if (input.pages < input.minPages) {
    reasons.push(`opened ${input.pages} pages, need at least ${input.minPages}`);
  }
  if (!keysLanded) {
    reasons.push(
      `edited paragraph text ${input.beforeLength} -> ${input.afterLength} (${paragraphGrowth} of ${input.keys} keys landed)`
    );
  }
  if (input.perKeyGrowth && input.perKeyGrowth.some((growth) => growth !== 1)) {
    const bad = input.perKeyGrowth.filter((growth) => growth !== 1).length;
    reasons.push(`${bad} keystroke(s) did not grow the edited paragraph by exactly one character`);
  }
  if (input.trustedBeforeInputCount !== undefined && input.trustedBeforeInputCount < input.keys) {
    reasons.push(
      `only ${input.trustedBeforeInputCount} of ${input.keys} keystrokes produced trusted beforeinput events`
    );
  }
  if (input.perKeyRevisionAdvance && input.perKeyRevisionAdvance.some((advanced) => !advanced)) {
    reasons.push('one or more keystrokes did not advance layout revision after paint');
  }
  if (input.probeSamples && !validateTypingProbeSamples(input.probeSamples, input.keys)) {
    reasons.push('one or more keystrokes did not produce a valid probe timing sample');
  }
  if (!input.caretInPagesLayer) {
    reasons.push('caret is not in the editable pages layer');
  }
  if (input.layoutRevisionBefore === null || input.layoutRevisionAfter === null) {
    reasons.push('layout revision marker `.docx-pages[data-revision]` is unavailable');
  } else if (input.layoutRevisionAfter <= input.layoutRevisionBefore) {
    reasons.push(
      `layout revision did not advance (${input.layoutRevisionBefore} -> ${input.layoutRevisionAfter})`
    );
  }
  if (
    input.caretOffsetBefore &&
    input.caretOffsetAfter &&
    input.caretOffsetBefore.paragraphId === input.caretOffsetAfter.paragraphId &&
    input.expectedCaretParagraphId &&
    input.caretOffsetBefore.paragraphId === input.expectedCaretParagraphId &&
    input.caretOffsetAfter.offset !== input.caretOffsetBefore.offset + input.keys
  ) {
    reasons.push(
      `caret offset ${input.caretOffsetBefore.offset} -> ${input.caretOffsetAfter.offset}, expected +${input.keys}`
    );
  }
  if (hasEditorRelatedConsoleErrors(input.consoleErrors)) {
    reasons.push('editor-related console errors were recorded');
  }
  if (input.pageErrors.length > 0) {
    reasons.push(`${input.pageErrors.length} page error(s) were recorded`);
  }

  const modelEvidence = keysLanded;
  const displayEvidence =
    input.layoutRevisionBefore !== null &&
    input.layoutRevisionAfter !== null &&
    input.layoutRevisionAfter > input.layoutRevisionBefore;
  const layoutEvidence = displayEvidence;
  const caretEvidence = input.caretInPagesLayer;
  const minPagesEvidence = input.pages >= input.minPages;
  const paragraphGrowthEvidence = keysLanded;
  const perKeyGrowthEvidence =
    !input.perKeyGrowth || input.perKeyGrowth.every((growth) => growth === 1);
  const trustedInputEvidence =
    input.trustedBeforeInputCount === undefined || input.trustedBeforeInputCount >= input.keys;
  const perKeyRevisionEvidence =
    !input.perKeyRevisionAdvance || input.perKeyRevisionAdvance.every(Boolean);
  const probeSampleEvidence =
    !input.probeSamples || validateTypingProbeSamples(input.probeSamples, input.keys);
  const caretOffsetEvidence =
    !input.expectedCaretParagraphId ||
    !input.caretOffsetBefore ||
    !input.caretOffsetAfter ||
    input.caretOffsetBefore.paragraphId !== input.expectedCaretParagraphId ||
    input.caretOffsetAfter.paragraphId !== input.expectedCaretParagraphId ||
    input.caretOffsetAfter.offset === input.caretOffsetBefore.offset + input.keys;

  const valid =
    minPagesEvidence &&
    paragraphGrowthEvidence &&
    perKeyGrowthEvidence &&
    trustedInputEvidence &&
    perKeyRevisionEvidence &&
    probeSampleEvidence &&
    caretEvidence &&
    caretOffsetEvidence &&
    modelEvidence &&
    layoutEvidence &&
    displayEvidence &&
    reasons.length === 0;

  return {
    valid,
    reasons,
    paragraphGrowth,
    keysLanded,
    evidence: {
      minPages: minPagesEvidence,
      paragraphGrowth: paragraphGrowthEvidence,
      perKeyGrowth: perKeyGrowthEvidence,
      trustedInput: trustedInputEvidence,
      perKeyRevision: perKeyRevisionEvidence,
      probeSamples: probeSampleEvidence,
      caret: caretEvidence,
      caretOffset: caretOffsetEvidence,
      model: modelEvidence,
      layout: layoutEvidence,
      display: displayEvidence,
    },
  };
}

/**
 * @param {ReturnType<typeof evaluateTypingRun>} verdict
 * @param {TypingUrlAuditArgs} args
 * @param {{
 *   url: string;
 *   opened: { pages: number; paragraphs: number };
 *   beforeLength: number;
 *   afterLength: number;
 *   sortedSamples: readonly number[];
 *   consoleErrors: readonly string[];
 *   pageErrors: readonly string[];
 *   profileLines?: readonly string[];
 *   trustedBeforeInputCount?: number;
 *   caretOffsetBefore?: { paragraphId: string; offset: number } | null;
 *   caretOffsetAfter?: { paragraphId: string; offset: number } | null;
 * }} report
 */
export function formatTypingAuditReport(verdict, args, report) {
  const lines = [];
  lines.push(`\n${report.url}`);
  lines.push(
    `opened ${report.opened.pages} pages, ${report.opened.paragraphs} paragraphs in the DOM`
  );
  lines.push(`${verdict.valid ? 'VALID' : 'INVALID'}`);
  if (!verdict.valid) {
    for (const reason of verdict.reasons) lines.push(`  - ${reason}`);
    lines.push(
      '\nINVALID: structural evidence failed. Latency metrics below are omitted because they would be meaningless.'
    );
    return lines.join('\n');
  }

  lines.push(
    `edited paragraph text ${report.beforeLength} -> ${report.afterLength} (${verdict.paragraphGrowth} of ${args.keys} keys landed)`
  );
  if (report.trustedBeforeInputCount !== undefined) {
    lines.push(`trusted beforeinput events: ${report.trustedBeforeInputCount} of ${args.keys}`);
  }
  if (report.caretOffsetBefore && report.caretOffsetAfter) {
    lines.push(
      `caret offset ${report.caretOffsetBefore.offset} -> ${report.caretOffsetAfter.offset} in edited paragraph`
    );
  }
  lines.push(
    `keystroke -> painted frame:  median ${quantile(report.sortedSamples, 0.5).toFixed(1)} ms   ` +
      `p95 ${quantile(report.sortedSamples, 0.95).toFixed(1)} ms   ` +
      `min ${report.sortedSamples[0].toFixed(1)} ms   ` +
      `max ${report.sortedSamples[report.sortedSamples.length - 1].toFixed(1)} ms`
  );
  lines.push('budget: 16.7 ms median, 33.4 ms p95');
  if (report.profileLines?.length) {
    lines.push(...report.profileLines);
  }
  if (report.consoleErrors.length > 0) {
    lines.push(`\nconsole errors (${report.consoleErrors.length}):`);
    for (const error of report.consoleErrors.slice(0, 5)) lines.push(`  ${error}`);
  }
  if (report.pageErrors.length > 0) {
    lines.push(`\npage errors (${report.pageErrors.length}):`);
    for (const error of report.pageErrors.slice(0, 5)) lines.push(`  ${error}`);
  }
  return lines.join('\n');
}

/**
 * Wait until painted page count stops increasing so load completes before validation.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ timeoutMs?: number; stableMs?: number; pollMs?: number }} [options]
 */
export async function waitForPaintedPageCountStable(
  page,
  { timeoutMs = 240_000, stableMs = 2_000, pollMs = 200 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  await page.waitForFunction(() => document.querySelectorAll('[data-page-index]').length >= 1, {
    timeout: timeoutMs,
  });
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => document.querySelectorAll('[data-page-index]').length);
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return lastCount;
    }
    await page.waitForTimeout(pollMs);
  }
  throw new Error(
    `painted page count did not stabilize within ${timeoutMs}ms (last count ${lastCount})`
  );
}

export function typingUrlAuditHelpText() {
  return (
    'bun scripts/bench/typing-url-audit.mjs [--fixture <name>.docx] [--keys N]\n' +
    '  [--url <full url>] [--min-pages N] [--paragraph N] [--settle MS]\n' +
    '  [--top N] [--no-profile]\n'
  );
}
