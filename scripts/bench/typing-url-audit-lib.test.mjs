import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import {
  DEFAULT_FIXTURE,
  DEFAULT_MIN_PAGES,
  caretOffsetFromDom,
  evaluateTypingRun,
  formatTypingAuditReport,
  hasEditorRelatedConsoleErrors,
  hasEditorRelatedErrors,
  layoutRevisionOf,
  parseBoundedNumber,
  parseTypingUrlAuditArgs,
  quantile,
  validateTypingProbeSample,
  validateTypingProbeSamples,
} from './typing-url-audit-lib.mjs';

describe('parseTypingUrlAuditArgs', () => {
  test('defaults target the 521-page fixture', () => {
    const args = parseTypingUrlAuditArgs([]);
    expect(args.fixture).toBe(DEFAULT_FIXTURE);
    expect(args.minPages).toBe(DEFAULT_MIN_PAGES);
    expect(args.url).toBe(`http://localhost:5173/?fixture=${DEFAULT_FIXTURE}`);
  });

  test('rejects non-finite numeric flags before browser launch', () => {
    expect(() => parseTypingUrlAuditArgs(['--keys', 'NaN'])).toThrow('--keys must be a finite number');
    expect(() => parseTypingUrlAuditArgs(['--min-pages', 'Infinity'])).toThrow(
      '--min-pages must be a finite number'
    );
  });

  test('rejects out-of-range numeric flags', () => {
    expect(() => parseTypingUrlAuditArgs(['--keys', '0'])).toThrow('--keys must be between');
    expect(() => parseTypingUrlAuditArgs(['--paragraph', '-1'])).toThrow('--paragraph must be between');
  });
});

describe('parseBoundedNumber', () => {
  test('accepts safe positive integers', () => {
    expect(parseBoundedNumber('12', { label: 'keys' })).toBe(12);
  });
});

describe('evaluateTypingRun', () => {
  test('requires paragraph growth and layout revision evidence', () => {
    const valid = evaluateTypingRun({
      pages: 521,
      minPages: 521,
      beforeLength: 10,
      afterLength: 22,
      keys: 12,
      layoutRevisionBefore: 3,
      layoutRevisionAfter: 15,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: [],
    });
    expect(valid.valid).toBe(true);
    expect(valid.evidence.layout).toBe(true);
  });

  test('fails closed when layout revision marker is unavailable', () => {
    const invalid = evaluateTypingRun({
      pages: 521,
      minPages: 521,
      beforeLength: 10,
      afterLength: 22,
      keys: 12,
      layoutRevisionBefore: null,
      layoutRevisionAfter: null,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: [],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons.some((reason) => reason.includes('layout revision marker'))).toBe(true);
  });

  test('any page error invalidates the run', () => {
    expect(hasEditorRelatedErrors([], ['ReferenceError: x is not defined'])).toBe(true);
    const invalid = evaluateTypingRun({
      pages: 521,
      minPages: 521,
      beforeLength: 10,
      afterLength: 22,
      keys: 12,
      layoutRevisionBefore: 1,
      layoutRevisionAfter: 13,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: ['ReferenceError: x is not defined'],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons.some((reason) => reason.includes('page error'))).toBe(true);
  });

  test('editor-related console errors invalidate the run', () => {
    expect(hasEditorRelatedConsoleErrors(['TypeError in paginated-surface'])).toBe(true);
    const invalid = evaluateTypingRun({
      pages: 521,
      minPages: 521,
      beforeLength: 10,
      afterLength: 22,
      keys: 12,
      layoutRevisionBefore: 1,
      layoutRevisionAfter: 2,
      caretInPagesLayer: true,
      consoleErrors: ['Error: layout failed in semantic-layout'],
      pageErrors: [],
    });
    expect(invalid.valid).toBe(false);
  });

  test('requires trusted beforeinput and per-key paragraph growth', () => {
    const invalid = evaluateTypingRun({
      pages: 521,
      minPages: 521,
      beforeLength: 10,
      afterLength: 22,
      keys: 12,
      layoutRevisionBefore: 1,
      layoutRevisionAfter: 13,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: [],
      perKeyGrowth: [1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      trustedBeforeInputCount: 11,
      perKeyRevisionAdvance: Array.from({ length: 12 }, () => true),
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons.some((reason) => reason.includes('beforeinput'))).toBe(true);
    expect(invalid.reasons.some((reason) => reason.includes('exactly one character'))).toBe(true);
  });

  test('layoutRevisionOf reads `.docx-pages[data-revision]`', () => {
    const root = document.createElement('div');
    const pages = document.createElement('div');
    pages.className = 'docx-pages';
    pages.setAttribute('data-revision', '42');
    root.appendChild(pages);
    expect(layoutRevisionOf(root)).toBe(42);
  });

  test('caretOffsetFromDom resolves collapsed caret offsets from span markers', () => {
    const root = document.createElement('div');
    root.className = 'docx-pages';
    const span = document.createElement('span');
    span.setAttribute('data-paragraph-id', '/word/document.xml#p1');
    span.setAttribute('data-start', '5');
    span.setAttribute('data-end', '8');
    span.textContent = 'abc';
    root.appendChild(span);
    document.body.appendChild(root);
    const text = span.firstChild;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(caretOffsetFromDom(document, root)).toEqual({
      paragraphId: '/word/document.xml#p1',
      offset: 7,
    });
    root.remove();
  });

  test('validates probe timing samples', () => {
    expect(validateTypingProbeSample({ ms: 12.5, revisionBefore: 3, revisionAfter: 4 })).toBe(true);
    expect(validateTypingProbeSample({ ms: -1, revisionBefore: 3, revisionAfter: 4 })).toBe(false);
    expect(validateTypingProbeSample({ ms: 12.5, revisionBefore: 4, revisionAfter: 4 })).toBe(false);
    expect(
      validateTypingProbeSamples(
        [
          { ms: 1, revisionBefore: 1, revisionAfter: 2 },
          { ms: 2, revisionBefore: 2, revisionAfter: 3 },
        ],
        2
      )
    ).toBe(true);
    expect(
      validateTypingProbeSamples([{ ms: 1, revisionBefore: 1, revisionAfter: 2 }], 2)
    ).toBe(false);
  });
});

describe('formatTypingAuditReport', () => {
  test('omits latency metrics for invalid runs', () => {
    const verdict = evaluateTypingRun({
      pages: 1,
      minPages: 521,
      beforeLength: 0,
      afterLength: 0,
      keys: 12,
      layoutRevisionBefore: null,
      layoutRevisionAfter: null,
      caretInPagesLayer: false,
      consoleErrors: [],
      pageErrors: [],
    });
    const text = formatTypingAuditReport(verdict, parseTypingUrlAuditArgs([]), {
      url: 'http://localhost:5173/',
      opened: { pages: 1, paragraphs: 1 },
      beforeLength: 0,
      afterLength: 0,
      sortedSamples: [100],
      consoleErrors: [],
      pageErrors: [],
    });
    expect(text).toContain('INVALID');
    expect(text).not.toContain('keystroke -> painted frame');
  });
});

describe('quantile', () => {
  test('returns null for an empty sample', () => {
    expect(quantile([], 0.5)).toBeNull();
  });
});
