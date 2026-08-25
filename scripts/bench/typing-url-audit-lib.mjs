/**
 * Pure helpers for `typing-url-audit.mjs` — parser, validation, and run verdict logic.
 * Unit-tested without a browser.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_FIXTURE = 'typing-perf-521pp.docx';
export const DEFAULT_GLOBAL_DEADLINE_MS = 240_000;
export const FIXTURE_BASENAME_PATTERN = /^[\w.-]+\.docx$/;

const MAX_KEYS = 10_000;
const MAX_SETTLE_MS = 60_000;
const MAX_TOP = 500;
const MAX_PARAGRAPH_INDEX = 1_000_000;
const MAX_MIN_PAGES = 100_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** @param {string} hostname */
export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * @param {string} rawUrl
 * @param {{ allowRemote?: boolean }} [options]
 */
export function validateHttpUrlPolicy(rawUrl, { allowRemote = false } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`URL is not valid: ${JSON.stringify(rawUrl)}`);
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { allowed: true, parsed, reason: 'non-http' };
  }
  if (!allowRemote && !isLoopbackHost(parsed.hostname)) {
    return { allowed: false, parsed, reason: 'non-loopback http(s)' };
  }
  return { allowed: true, parsed, reason: null };
}

/**
 * @param {number} deadlineAt
 * @param {{ label?: string; globalDeadlineMs?: number }} [options]
 */
export function requireRemainingMs(deadlineAt, { label = 'operation', globalDeadlineMs } = {}) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    const suffix =
      globalDeadlineMs !== undefined
        ? `global deadline of ${globalDeadlineMs}ms exceeded`
        : 'global deadline exceeded';
    throw new Error(`${label}: ${suffix}`);
  }
  return Math.max(1, remaining);
}

/** @typedef {{
 *   fixture: string;
 *   keys: number;
 *   url: string | null;
 *   minPages: number | null;
 *   paragraphIndex: number | null;
 *   targetParagraphContentMarker: string | null;
 *   targetParagraphNodeId: string | null;
 *   settleMs: number;
 *   profile: boolean;
 *   top: number;
 *   allowRemote: boolean;
 *   globalDeadlineMs: number;
 * }} TypingUrlAuditArgs */

/** @typedef {{
 *   sourceCategory: string;
 *   purpose: string;
 *   notes?: string;
 *   fixtures: Record<string, {
 *     sha256: string;
 *     byteSize: number;
 *     expectedPageCount: number;
 *     targetParagraphContentMarker?: string;
 *     targetParagraphNodeId?: string;
 *   }>;
 * }} TypingPerfFixtureManifest */

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

/** @param {string} fixture */
export function assertSafeFixtureBasename(fixture) {
  if (!FIXTURE_BASENAME_PATTERN.test(fixture)) {
    throw new Error(
      `--fixture must be a bare .docx basename (letters, digits, _, ., -); got ${JSON.stringify(fixture)}`
    );
  }
}

/** @param {string} fixture */
export function loadTypingPerfFixtureManifest(fixture = DEFAULT_FIXTURE) {
  const manifestPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../e2e/fixtures/typing-perf-521pp.manifest.json'
  );
  /** @type {TypingPerfFixtureManifest} */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = manifest.fixtures[fixture];
  if (!entry) {
    throw new Error(`fixture ${fixture} is missing from ${manifestPath}`);
  }
  return { manifest, entry };
}

/**
 * @param {string} rawUrl
 * @param {{ allowRemote?: boolean }} [options]
 */
export function validateAuditUrl(rawUrl, { allowRemote = false } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`--url is not a valid URL: ${JSON.stringify(rawUrl)}`);
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'file:' || protocol === 'data:' || protocol === 'javascript:') {
    throw new Error(`--url scheme ${protocol} is not allowed`);
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`--url must use http or https; got ${protocol}`);
  }
  if (!allowRemote && !isLoopbackHost(parsed.hostname.toLowerCase())) {
    throw new Error(
      `--url host ${parsed.hostname} is not loopback; pass --allow-remote to permit remote hosts`
    );
  }
  return parsed;
}

/**
 * @param {string} fixture
 * @param {{ perfE2e?: boolean }} [options]
 */
export function defaultAuditUrlForFixture(fixture, { perfE2e = true } = {}) {
  assertSafeFixtureBasename(fixture);
  const params = new URLSearchParams();
  if (perfE2e) params.set('perfE2e', '1');
  params.set('fixture', fixture);
  return `http://localhost:5173/?${params.toString()}`;
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
    minPages: null,
    paragraphIndex: null,
    targetParagraphContentMarker: null,
    targetParagraphNodeId: null,
    settleMs: 250,
    profile: false,
    top: 30,
    allowRemote: false,
    globalDeadlineMs: DEFAULT_GLOBAL_DEADLINE_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--fixture') {
      if (typeof value !== 'string' || value.length === 0)
        throw new Error('--fixture requires a value');
      assertSafeFixtureBasename(value);
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
    } else if (flag === '--profile') {
      out.profile = true;
    } else if (flag === '--allow-remote') {
      out.allowRemote = true;
    } else if (flag === '--deadline-ms') {
      out.globalDeadlineMs = parseBoundedNumber(value, {
        min: 1_000,
        max: 600_000,
        label: '--deadline-ms',
      });
      index += 1;
    } else if (flag === '--help') {
      return out;
    } else {
      throw new Error(`unknown flag ${flag}`);
    }
  }

  const { entry } = loadTypingPerfFixtureManifest(out.fixture);
  out.targetParagraphContentMarker ??= entry.targetParagraphContentMarker ?? null;
  out.targetParagraphNodeId ??= entry.targetParagraphNodeId ?? null;
  out.minPages ??= entry.expectedPageCount;

  out.url ??= defaultAuditUrlForFixture(out.fixture);
  validateAuditUrl(out.url, { allowRemote: out.allowRemote });
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
 * @param {readonly { type: string; text: string }[]} consoleEvents
 */
export function hasConsoleErrors(consoleEvents) {
  return consoleEvents.some((event) => event.type === 'error');
}

/**
 * Aggregate the responsiveness probe: slow Event Timing entries (the API only reports
 * interactions past its 16 ms floor, so every entry here already crossed one frame) and
 * long tasks. Null when neither list has an entry, which the report prints as the
 * all-clear line.
 *
 * Callers filter both lists to the typing window first (`startTimeMs` on each entry):
 * buffered observers also capture the document open, whose long task would otherwise
 * dominate every typing report. Callers must also gate on the probe's `observerSupport`
 * flags and pass nothing through when neither observer installed — an empty list is an
 * all-clear only when its API was actually watching.
 *
 * @param {readonly { name: string; inputDelayMs: number; durationMs: number }[]} slowInputEvents
 * @param {readonly number[]} longTaskDurations
 * @returns {{ slowInputCount: number; worstInputDelayMs: number; worstEventDurationMs: number; longTaskCount: number; worstLongTaskMs: number } | null}
 */
export function summarizeResponsiveness(slowInputEvents, longTaskDurations) {
  if (slowInputEvents.length === 0 && longTaskDurations.length === 0) return null;
  let worstInputDelayMs = 0;
  let worstEventDurationMs = 0;
  for (const event of slowInputEvents) {
    if (event.inputDelayMs > worstInputDelayMs) worstInputDelayMs = event.inputDelayMs;
    if (event.durationMs > worstEventDurationMs) worstEventDurationMs = event.durationMs;
  }
  let worstLongTaskMs = 0;
  for (const duration of longTaskDurations) {
    if (duration > worstLongTaskMs) worstLongTaskMs = duration;
  }
  return {
    slowInputCount: slowInputEvents.length,
    worstInputDelayMs,
    worstEventDurationMs,
    longTaskCount: longTaskDurations.length,
    worstLongTaskMs,
  };
}

/**
 * @param {readonly { type: string; text: string }[]} consoleEvents
 * @param {readonly string[]} pageErrors
 */
export function hasAuditErrors(consoleEvents, pageErrors) {
  return hasConsoleErrors(consoleEvents) || pageErrors.length > 0;
}

/** @typedef {{ startMs: number; revisionBefore: number | null }} TypingAuditPendingSample */
/** @typedef {{ ms: number; revisionBefore: number | null; revisionAfter: number | null; validationRecordedAtMs: number | null }} TypingAuditProbeSample */

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
 * Browser-side typing probe: trusted beforeinput starts the timer; the second animation frame
 * after a layout revision mutation finishes it.
 */
export function installTypingAuditProbeInPage() {
  /** @type {{ trustedBeforeInputs: number; pendingSample: TypingAuditPendingSample | null; samples: TypingAuditProbeSample[]; slowInputEvents: { name: string; inputDelayMs: number; durationMs: number; startTimeMs: number }[]; longTasks: { durationMs: number; startTimeMs: number }[]; observerSupport: { eventTiming: boolean; longTask: boolean } }} */
  const probe = {
    trustedBeforeInputs: 0,
    pendingSample: null,
    samples: [],
    slowInputEvents: [],
    longTasks: [],
    // Distinguishes "quiet run" from "the API is unsupported here": an empty list is an
    // all-clear ONLY when its observer actually installed.
    observerSupport: { eventTiming: false, longTask: false },
  };
  globalThis.__typingAuditProbe = probe;

  // Event Timing only reports interactions whose total duration crosses the threshold
  // (16 ms is the API floor), so these are the SLOW events by construction: an empty list
  // means no interaction crossed one frame. `inputDelayMs` is processingStart - startTime —
  // the time the event waited for the main thread, the browser-truth queueing signal.
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const timed =
          /** @type {{ name: string; startTime: number; duration: number; processingStart?: number }} */ (
            entry
          );
        if (typeof timed.processingStart !== 'number') continue;
        probe.slowInputEvents.push({
          name: timed.name,
          inputDelayMs: timed.processingStart - timed.startTime,
          durationMs: timed.duration,
          startTimeMs: timed.startTime,
        });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    probe.observerSupport.eventTiming = true;
  } catch {
    // Event Timing is unsupported here; the report omits the section instead of claiming quiet.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.longTasks.push({ durationMs: entry.duration, startTimeMs: entry.startTime });
      }
    }).observe({ type: 'longtask', buffered: true });
    probe.observerSupport.longTask = true;
  } catch {
    // Long Tasks is unsupported here; the report omits the section instead of claiming quiet.
  }

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
        requestAnimationFrame(() => {
          probe.samples.push({
            ms: performance.now() - pending.startMs,
            revisionBefore: pending.revisionBefore,
            revisionAfter,
            validationRecordedAtMs: null,
          });
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
 *   expectedPages: number;
 *   beforeLength: number;
 *   afterLength: number;
 *   beforeModelLength?: number;
 *   afterModelLength?: number;
 *   keys: number;
 *   layoutRevisionBefore: number | null;
 *   layoutRevisionAfter: number | null;
 *   caretInPagesLayer: boolean;
 *   consoleErrors: readonly { type: string; text: string }[];
 *   pageErrors: readonly string[];
 *   requestFailures?: readonly { url: string; failure: string }[];
 *   perKeyGrowth?: readonly number[];
 *   perKeyPaintedXCount?: readonly number[];
 *   trustedBeforeInputCount?: number;
 *   perKeyRevisionAdvance?: readonly boolean[];
 *   caretOffsetBefore?: { paragraphId: string; offset: number } | null;
 *   caretOffsetAfter?: { paragraphId: string; offset: number } | null;
 *   expectedCaretParagraphId?: string | null;
 *   probeSamples?: readonly TypingAuditProbeSample[];
 *   modelTextBefore?: string | null;
 *   modelTextAfter?: string | null;
 *   paintedTextBefore?: string | null;
 *   paintedTextAfter?: string | null;
 *   insertionOffset?: number | null;
 *   paintedInsertionOffset?: number | null;
 * }} input
 */
export function evaluateTypingRun(input) {
  const reasons = [];
  const paragraphGrowth = input.afterLength - input.beforeLength;
  const keysLanded = paragraphGrowth === input.keys;
  const modelBefore = input.beforeModelLength ?? Number.NaN;
  const modelAfter = input.afterModelLength ?? Number.NaN;
  const modelGrowth = modelAfter - modelBefore;
  const insertionOffset = input.insertionOffset ?? input.caretOffsetBefore?.offset ?? null;
  const paintedInsertionOffset = input.paintedInsertionOffset ?? insertionOffset;

  if (input.pages !== input.expectedPages) {
    reasons.push(`opened ${input.pages} pages, expected exactly ${input.expectedPages}`);
  }
  if (!keysLanded) {
    reasons.push(
      `edited paragraph painted length ${input.beforeLength} -> ${input.afterLength} (${paragraphGrowth} of ${input.keys} keys landed)`
    );
  }
  if (input.modelTextBefore === undefined || input.modelTextBefore === null) {
    reasons.push('canonical model text before typing is unavailable');
  }
  if (input.modelTextAfter === undefined || input.modelTextAfter === null) {
    reasons.push('canonical model text after typing is unavailable');
  }
  if (!Number.isFinite(modelGrowth) || modelGrowth !== input.keys) {
    reasons.push(
      `canonical model length ${modelBefore} -> ${modelAfter} (${modelGrowth} of ${input.keys} keys landed)`
    );
  }
  if (
    input.modelTextBefore !== undefined &&
    input.modelTextBefore !== null &&
    input.modelTextAfter !== undefined &&
    input.modelTextAfter !== null &&
    insertionOffset !== null
  ) {
    const expectedModel =
      input.modelTextBefore.slice(0, insertionOffset) +
      'x'.repeat(input.keys) +
      input.modelTextBefore.slice(insertionOffset);
    if (input.modelTextAfter !== expectedModel) {
      reasons.push('canonical model text content does not contain the inserted characters');
    }
  }
  if (
    input.paintedTextBefore !== undefined &&
    input.paintedTextBefore !== null &&
    input.paintedTextAfter !== undefined &&
    input.paintedTextAfter !== null &&
    paintedInsertionOffset !== null
  ) {
    const inserted = input.paintedTextAfter.slice(
      paintedInsertionOffset,
      paintedInsertionOffset + input.keys
    );
    if (inserted !== 'x'.repeat(input.keys)) {
      reasons.push('painted text does not contain the inserted characters');
    }
    if (input.paintedTextAfter.length !== input.paintedTextBefore.length + input.keys) {
      reasons.push('painted text length did not grow by one character per keystroke');
    }
  } else {
    reasons.push('painted text or insertion-offset evidence is unavailable');
  }
  if (!input.perKeyGrowth || input.perKeyGrowth.length !== input.keys) {
    reasons.push('per-keystroke paragraph growth evidence is incomplete');
  } else if (input.perKeyGrowth.some((growth) => growth !== 1)) {
    const bad = input.perKeyGrowth.filter((growth) => growth !== 1).length;
    reasons.push(`${bad} keystroke(s) did not grow the edited paragraph by exactly one character`);
  }
  if (input.trustedBeforeInputCount === undefined) {
    reasons.push('trusted beforeinput evidence is unavailable');
  } else if (input.trustedBeforeInputCount !== input.keys) {
    reasons.push(
      `only ${input.trustedBeforeInputCount} of ${input.keys} keystrokes produced trusted beforeinput events`
    );
  }
  if (!input.perKeyRevisionAdvance || input.perKeyRevisionAdvance.length !== input.keys) {
    reasons.push('per-keystroke layout revision evidence is incomplete');
  } else if (input.perKeyRevisionAdvance.some((advanced) => !advanced)) {
    reasons.push('one or more keystrokes did not advance layout revision after paint');
  }
  if (!input.probeSamples || !validateTypingProbeSamples(input.probeSamples, input.keys)) {
    reasons.push('one or more keystrokes did not produce a valid probe timing sample');
  }
  if (!input.caretInPagesLayer) {
    reasons.push('caret is not in the editable pages layer');
  }
  if (!input.caretOffsetBefore) {
    reasons.push('caret offset before typing is unavailable');
  }
  if (!input.caretOffsetAfter) {
    reasons.push('caret offset after typing is unavailable');
  }
  if (
    input.expectedCaretParagraphId &&
    input.caretOffsetBefore &&
    input.caretOffsetBefore.paragraphId !== input.expectedCaretParagraphId
  ) {
    reasons.push('caret before typing is in the wrong paragraph');
  }
  if (
    input.expectedCaretParagraphId &&
    input.caretOffsetAfter &&
    input.caretOffsetAfter.paragraphId !== input.expectedCaretParagraphId
  ) {
    reasons.push('caret after typing is in the wrong paragraph');
  }
  if (
    input.caretOffsetBefore &&
    input.caretOffsetAfter &&
    input.expectedCaretParagraphId &&
    input.caretOffsetBefore.paragraphId === input.expectedCaretParagraphId &&
    input.caretOffsetAfter.paragraphId === input.expectedCaretParagraphId &&
    input.caretOffsetAfter.offset !== input.caretOffsetBefore.offset + input.keys
  ) {
    reasons.push(
      `caret offset ${input.caretOffsetBefore.offset} -> ${input.caretOffsetAfter.offset}, expected +${input.keys}`
    );
  }
  if (input.layoutRevisionBefore === null || input.layoutRevisionAfter === null) {
    reasons.push('layout revision marker `.docx-pages[data-revision]` is unavailable');
  } else if (input.layoutRevisionAfter <= input.layoutRevisionBefore) {
    reasons.push(
      `layout revision did not advance (${input.layoutRevisionBefore} -> ${input.layoutRevisionAfter})`
    );
  }
  if (hasConsoleErrors(input.consoleErrors)) {
    const consoleErrorCount = input.consoleErrors.filter((event) => event.type === 'error').length;
    reasons.push(`${consoleErrorCount} console error(s) were recorded`);
  }
  if (input.pageErrors.length > 0) {
    reasons.push(`${input.pageErrors.length} page error(s) were recorded`);
  }
  if (input.requestFailures && input.requestFailures.length > 0) {
    reasons.push(`${input.requestFailures.length} request failure(s) were recorded`);
  }

  const exactPagesEvidence = input.pages === input.expectedPages;
  const paragraphGrowthEvidence = keysLanded;
  const modelEvidence =
    typeof input.modelTextBefore === 'string' &&
    typeof input.modelTextAfter === 'string' &&
    modelGrowth === input.keys;
  const perKeyGrowthEvidence =
    input.perKeyGrowth?.length === input.keys && input.perKeyGrowth.every((growth) => growth === 1);
  const paintedTextEvidence =
    typeof input.paintedTextBefore === 'string' &&
    typeof input.paintedTextAfter === 'string' &&
    paintedInsertionOffset !== null &&
    input.paintedTextAfter.slice(paintedInsertionOffset, paintedInsertionOffset + input.keys) ===
      'x'.repeat(input.keys) &&
    input.paintedTextAfter.length === input.paintedTextBefore.length + input.keys;
  const trustedInputEvidence =
    input.trustedBeforeInputCount !== undefined && input.trustedBeforeInputCount === input.keys;
  const perKeyRevisionEvidence =
    input.perKeyRevisionAdvance?.length === input.keys &&
    input.perKeyRevisionAdvance.every(Boolean);
  const probeSampleEvidence =
    Boolean(input.probeSamples) && validateTypingProbeSamples(input.probeSamples ?? [], input.keys);
  const caretLayerEvidence = input.caretInPagesLayer;
  const caretOffsetEvidence =
    Boolean(input.caretOffsetBefore) &&
    Boolean(input.caretOffsetAfter) &&
    (!input.expectedCaretParagraphId ||
      (input.caretOffsetBefore.paragraphId === input.expectedCaretParagraphId &&
        input.caretOffsetAfter.paragraphId === input.expectedCaretParagraphId &&
        input.caretOffsetAfter.offset === input.caretOffsetBefore.offset + input.keys));
  const layoutEvidence =
    input.layoutRevisionBefore !== null &&
    input.layoutRevisionAfter !== null &&
    input.layoutRevisionAfter > input.layoutRevisionBefore;
  const cleanPageEvidence = input.pageErrors.length === 0;
  const cleanConsoleEvidence = !hasConsoleErrors(input.consoleErrors);
  const cleanRequestEvidence = !input.requestFailures || input.requestFailures.length === 0;

  const valid =
    exactPagesEvidence &&
    paragraphGrowthEvidence &&
    modelEvidence &&
    perKeyGrowthEvidence &&
    paintedTextEvidence &&
    trustedInputEvidence &&
    perKeyRevisionEvidence &&
    probeSampleEvidence &&
    caretLayerEvidence &&
    caretOffsetEvidence &&
    layoutEvidence &&
    cleanPageEvidence &&
    cleanConsoleEvidence &&
    cleanRequestEvidence &&
    reasons.length === 0;

  return {
    valid,
    reasons,
    paragraphGrowth,
    keysLanded,
    evidence: {
      exactPages: exactPagesEvidence,
      paragraphGrowth: paragraphGrowthEvidence,
      model: modelEvidence,
      perKeyGrowth: perKeyGrowthEvidence,
      paintedText: paintedTextEvidence,
      trustedInput: trustedInputEvidence,
      perKeyRevision: perKeyRevisionEvidence,
      probeSamples: probeSampleEvidence,
      caretLayer: caretLayerEvidence,
      caretOffset: caretOffsetEvidence,
      layout: layoutEvidence,
      cleanPage: cleanPageEvidence,
      cleanConsole: cleanConsoleEvidence,
      cleanRequest: cleanRequestEvidence,
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
 *   beforeModelLength?: number;
 *   afterModelLength?: number;
 *   sortedSamples: readonly number[];
 *   consoleErrors: readonly { type: string; text: string }[];
 *   pageErrors: readonly string[];
 *   requestFailures?: readonly { url: string; failure: string }[];
 *   profileLines?: readonly string[];
 *   responsiveness?: { slowInputCount: number; worstInputDelayMs: number; worstEventDurationMs: number; longTaskCount: number; worstLongTaskMs: number } | null;
 *   trustedBeforeInputCount?: number;
 *   caretOffsetBefore?: { paragraphId: string; offset: number } | null;
 *   caretOffsetAfter?: { paragraphId: string; offset: number } | null;
 *   targetParagraphId?: string | null;
 * }} report
 */
export function formatTypingAuditReport(verdict, args, report) {
  const lines = [];
  lines.push(`\n${report.url}`);
  lines.push(
    `opened ${report.opened.pages} pages, ${report.opened.paragraphs} paragraphs in the DOM`
  );
  if (report.targetParagraphId) {
    lines.push(`target paragraph ${report.targetParagraphId}`);
  }
  lines.push(`${verdict.valid ? 'VALID' : 'INVALID'}`);
  if (!verdict.valid) {
    for (const reason of verdict.reasons) lines.push(`  - ${reason}`);
    const errorEvents = report.consoleErrors.filter((event) => event.type === 'error');
    if (errorEvents.length > 0) {
      lines.push('\nconsole errors:');
      for (const error of errorEvents) lines.push(`  [${error.type}] ${error.text}`);
    }
    if (report.pageErrors.length > 0) {
      lines.push('\npage errors:');
      for (const error of report.pageErrors) lines.push(`  ${error}`);
    }
    if (report.requestFailures?.length) {
      lines.push('\nrequest failures:');
      for (const failure of report.requestFailures) {
        lines.push(`  ${failure.url}: ${failure.failure}`);
      }
    }
    lines.push(
      '\nINVALID: structural evidence failed. Latency metrics below are omitted because they would be meaningless.'
    );
    return lines.join('\n');
  }

  lines.push(
    `edited paragraph painted length ${report.beforeLength} -> ${report.afterLength} (${verdict.paragraphGrowth} of ${args.keys} keys landed)`
  );
  if (report.beforeModelLength !== undefined && report.afterModelLength !== undefined) {
    lines.push(`canonical model length ${report.beforeModelLength} -> ${report.afterModelLength}`);
  }
  if (report.trustedBeforeInputCount !== undefined) {
    lines.push(`trusted beforeinput events: ${report.trustedBeforeInputCount} of ${args.keys}`);
  }
  if (report.caretOffsetBefore && report.caretOffsetAfter) {
    lines.push(
      `caret offset ${report.caretOffsetBefore.offset} -> ${report.caretOffsetAfter.offset} in edited paragraph`
    );
  }
  lines.push(
    `keystroke -> layout revision (2nd animation frame):  median ${quantile(report.sortedSamples, 0.5).toFixed(1)} ms   ` +
      `p95 ${quantile(report.sortedSamples, 0.95).toFixed(1)} ms   ` +
      `min ${report.sortedSamples[0].toFixed(1)} ms   ` +
      `max ${report.sortedSamples[report.sortedSamples.length - 1].toFixed(1)} ms`
  );
  if (report.responsiveness) {
    const r = report.responsiveness;
    lines.push(
      `slow input events (>=16 ms duration): ${r.slowInputCount}, worst input delay ${r.worstInputDelayMs.toFixed(1)} ms, worst duration ${r.worstEventDurationMs.toFixed(1)} ms`
    );
    lines.push(`long tasks: ${r.longTaskCount}, worst ${r.worstLongTaskMs.toFixed(1)} ms`);
  } else if (report.responsiveness === null) {
    lines.push('no input event crossed 16 ms and no long task was observed');
  }
  lines.push(
    'budget: 16.7 ms median, 33.4 ms p95 (latency mode only; profile output is not budgeted)'
  );
  if (report.profileLines?.length) {
    lines.push(...report.profileLines);
  }
  return lines.join('\n');
}

/**
 * @param {{ valid: false; reasons: readonly string[]; detail?: string; consoleErrors?: readonly { type: string; text: string }[]; pageErrors?: readonly string[]; requestFailures?: readonly { url: string; failure: string }[] }} input
 */
export function formatStructuredInvalid(input) {
  const lines = ['INVALID'];
  if (input.detail) lines.push(`  - ${input.detail}`);
  for (const reason of input.reasons) lines.push(`  - ${reason}`);
  const errorEvents = input.consoleErrors?.filter((event) => event.type === 'error') ?? [];
  if (errorEvents.length) {
    lines.push('\nconsole errors:');
    for (const error of errorEvents) lines.push(`  [${error.type}] ${error.text}`);
  }
  if (input.pageErrors?.length) {
    lines.push('\npage errors:');
    for (const error of input.pageErrors) lines.push(`  ${error}`);
  }
  if (input.requestFailures?.length) {
    lines.push('\nrequest failures:');
    for (const failure of input.requestFailures) lines.push(`  ${failure.url}: ${failure.failure}`);
  }
  lines.push(
    '\nINVALID: structural evidence failed. Latency metrics are omitted because they would be meaningless.'
  );
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
  { timeoutMs = 240_000, stableMs = 2_000, pollMs = 200, deadlineAt } = {}
) {
  const boundedTimeout = deadlineAt
    ? requireRemainingMs(deadlineAt, { label: 'wait for painted pages' })
    : Math.max(1, timeoutMs);
  const deadline = Date.now() + boundedTimeout;
  await page.waitForFunction(() => document.querySelectorAll('[data-page-index]').length >= 1, {
    timeout: boundedTimeout,
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
    const pollBudget = deadlineAt
      ? requireRemainingMs(deadlineAt, { label: 'wait for painted page stability' })
      : Math.max(1, Math.min(pollMs, deadline - Date.now()));
    await page.waitForTimeout(Math.min(pollMs, pollBudget));
  }
  throw new Error(
    `painted page count did not stabilize within ${boundedTimeout}ms (last count ${lastCount})`
  );
}

/** @param {import('@playwright/test').Page} page @param {{ timeoutMs?: number; deadlineAt?: number }} [options] */
export async function waitForPerfE2EBridge(page, { timeoutMs, deadlineAt } = {}) {
  const boundedTimeout = deadlineAt
    ? requireRemainingMs(deadlineAt, { label: 'wait for perf E2E bridge' })
    : Math.max(1, timeoutMs ?? 240_000);
  await page.waitForFunction(() => globalThis.__DOCX_EDITOR_E2E__?.ready?.() === true, {
    timeout: boundedTimeout,
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string | null | undefined} contentMarker
 * @param {string | null | undefined} expectedNodeId
 */
export async function resolveTargetParagraphId(page, contentMarker, expectedNodeId) {
  return page.evaluate(
    ({ contentMarker, expectedNodeId }) => {
      const bridge = globalThis.__DOCX_EDITOR_E2E__;
      const editor = bridge?.getEditor?.();
      const surface = editor?.surface;
      if (!surface) return null;
      if (expectedNodeId && surface.session.paragraphIds().includes(expectedNodeId)) {
        return expectedNodeId;
      }
      if (!contentMarker) return null;
      for (const paragraphId of surface.session.paragraphIds()) {
        const text = bridge?.benchmarkParagraphModelText?.(paragraphId);
        if (text === contentMarker) return paragraphId;
      }
      return null;
    },
    { contentMarker, expectedNodeId }
  );
}

export function typingUrlAuditHelpText() {
  return (
    'bun scripts/bench/typing-url-audit.mjs [--fixture <name>.docx] [--keys N]\n' +
    '  [--url <full url>] [--min-pages N] [--paragraph N] [--settle MS]\n' +
    '  [--top N] [--profile] [--allow-remote] [--deadline-ms N]\n'
  );
}

/**
 * @param {import('playwright-core').Protocol.Profiler.Profile} profile
 */
export function validateProfileWindow(profile) {
  const deltas = profile.timeDeltas ?? [];
  if (deltas.length === 0) return false;
  const sumMicros = deltas.reduce((total, delta) => total + Math.max(delta ?? 0, 0), 0);
  const start = profile.startTime;
  const end = profile.endTime;
  if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return false;
  const windowMicros = end - start;
  const tolerance = Math.max(windowMicros * 0.25, 5_000);
  return Math.abs(sumMicros - windowMicros) <= tolerance;
}

/**
 * @param {readonly import('playwright-core').Protocol.Profiler.Profile[]} profiles
 * @param {number} keys
 * @param {number} top
 */
export function buildProfileReport(profiles, keys, top) {
  if (profiles.length === 0) {
    return {
      valid: false,
      lines: ['\nCPU profile: INVALID (no profile windows were captured)'],
    };
  }
  for (const [index, profile] of profiles.entries()) {
    if (!validateProfileWindow(profile)) {
      return {
        valid: false,
        lines: [
          `\nCPU profile: INVALID (window ${index + 1} timing is inconsistent; attribution omitted)`,
        ],
      };
    }
  }
  return {
    valid: true,
    lines: formatProfileLines(mergeProfileWindows(profiles), keys, top),
  };
}

/**
 * @param {readonly import('playwright-core').Protocol.Profiler.Profile[]} profiles
 */
export function mergeProfileWindows(profiles) {
  /** @type {import('playwright-core').Protocol.Profiler.Profile} */
  const merged = { nodes: [], samples: [], timeDeltas: [] };
  const nodeIdRemap = new Map();
  let nextNodeId = 1;
  for (const profile of profiles) {
    const localToMerged = new Map();
    for (const node of profile.nodes) {
      const mergedId = nextNodeId++;
      localToMerged.set(node.id, mergedId);
      merged.nodes.push({ ...node, id: mergedId });
    }
    for (const sample of profile.samples) {
      merged.samples.push(localToMerged.get(sample) ?? sample);
    }
    merged.timeDeltas.push(...(profile.timeDeltas ?? []));
  }
  return merged;
}

/**
 * Rank CPU profile samples, treating `(program)` as active unattributed time.
 *
 * @param {import('playwright-core').Protocol.Profiler.Profile} profile
 * @param {number} keys
 * @param {number} top
 */
export function formatProfileLines(profile, keys, top) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const deltas = profile.timeDeltas ?? [];
  const selfTime = new Map();
  for (let index = 0; index < profile.samples.length; index += 1) {
    const id = profile.samples[index];
    selfTime.set(id, (selfTime.get(id) ?? 0) + Math.max(deltas[index] ?? 0, 0));
  }
  const byFunction = new Map();
  for (const [id, micros] of selfTime) {
    const node = nodes.get(id);
    if (!node) continue;
    const frame = node.callFrame;
    const name = frame.functionName || '(anonymous)';
    if (name === '(idle)') continue;
    const file = (frame.url || '').split('/').pop()?.split('?')[0] ?? '';
    const key = `${name}|${file}:${frame.lineNumber + 1}`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + micros);
  }
  const ranked = [...byFunction.entries()].sort((a, b) => b[1] - a[1]);
  const active = ranked.reduce((sum, [, micros]) => sum + micros, 0);
  /** @type {string[]} */
  const lines = [];
  lines.push(
    `\nCPU profile (input-to-sample windows only): ${(active / 1000 / keys).toFixed(1)} ms/key active`
  );
  lines.push(`${'ms/key'.padStart(8)}  ${'%'.padStart(5)}  function (file:line)`);
  for (const [key, micros] of ranked.slice(0, top)) {
    const [name, where] = key.split('|');
    lines.push(
      `${(micros / 1000 / keys).toFixed(2).padStart(8)}  ` +
        `${active > 0 ? ((100 * micros) / active).toFixed(1).padStart(5) : '  0.0'}  ${name} (${where})`
    );
  }
  return lines;
}
