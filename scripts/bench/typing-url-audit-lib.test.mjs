#!/usr/bin/env bun
import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import {
  DEFAULT_FIXTURE,
  assertSafeFixtureBasename,
  buildProfileReport,
  caretOffsetFromDom,
  defaultAuditUrlForFixture,
  evaluateTypingRun,
  formatTypingAuditReport,
  formatStructuredInvalid,
  hasAuditErrors,
  hasConsoleErrors,
  layoutRevisionOf,
  loadTypingPerfFixtureManifest,
  parseBoundedNumber,
  parseTypingUrlAuditArgs,
  quantile,
  requireRemainingMs,
  summarizeResponsiveness,
  validateAuditUrl,
  validateHttpUrlPolicy,
  validateProfileWindow,
  validateTypingProbeSample,
  validateTypingProbeSamples,
} from './typing-url-audit-lib.mjs';

describe('parseTypingUrlAuditArgs', () => {
  test('defaults target the 521-page fixture with perf E2E bridge', () => {
    const args = parseTypingUrlAuditArgs([]);
    expect(args.fixture).toBe(DEFAULT_FIXTURE);
    expect(args.minPages).toBe(521);
    expect(args.url).toBe(defaultAuditUrlForFixture(DEFAULT_FIXTURE));
    expect(args.profile).toBe(false);
    expect(args.targetParagraphContentMarker).toBe('Total Element Categories: 50+');
  });

  test('rejects unsafe fixture basenames', () => {
    expect(() => parseTypingUrlAuditArgs(['--fixture', '../evil.docx'])).toThrow(
      'bare .docx basename'
    );
    expect(() => assertSafeFixtureBasename('http://evil.docx')).toThrow();
  });

  test('rejects non-loopback URLs unless --allow-remote is set', () => {
    expect(() => validateAuditUrl('https://example.com/?fixture=typing-perf-521pp.docx')).toThrow(
      'loopback'
    );
    expect(
      validateAuditUrl('https://example.com/?fixture=typing-perf-521pp.docx', {
        allowRemote: true,
      }).hostname
    ).toBe('example.com');
    expect(() => validateAuditUrl('file:///tmp/x.docx')).toThrow('not allowed');
  });

  test('rejects non-finite numeric flags before browser launch', () => {
    expect(() => parseTypingUrlAuditArgs(['--keys', 'NaN'])).toThrow(
      '--keys must be a finite number'
    );
    expect(() => parseTypingUrlAuditArgs(['--min-pages', 'Infinity'])).toThrow(
      '--min-pages must be a finite number'
    );
  });

  test('--profile opts into CPU profiling', () => {
    expect(parseTypingUrlAuditArgs(['--profile']).profile).toBe(true);
  });
});

describe('parseBoundedNumber', () => {
  test('accepts safe positive integers', () => {
    expect(parseBoundedNumber('12', { label: 'keys' })).toBe(12);
  });
});

describe('loadTypingPerfFixtureManifest', () => {
  test('loads provenance and target marker fields', () => {
    const { manifest, entry } = loadTypingPerfFixtureManifest();
    expect(manifest.sourceCategory.length).toBeGreaterThan(0);
    expect(entry.expectedPageCount).toBe(521);
    expect(entry.targetParagraphContentMarker).toBeTruthy();
  });
});

describe('evaluateTypingRun', () => {
  test('requires exact page count and layout revision evidence', () => {
    const valid = evaluateTypingRun({
      pages: 521,
      expectedPages: 521,
      beforeLength: 10,
      afterLength: 22,
      beforeModelLength: 10,
      afterModelLength: 22,
      keys: 12,
      layoutRevisionBefore: 3,
      layoutRevisionAfter: 15,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: [],
      caretOffsetBefore: { paragraphId: '/word/document.xml#0.0.8', offset: 10 },
      caretOffsetAfter: { paragraphId: '/word/document.xml#0.0.8', offset: 22 },
      expectedCaretParagraphId: '/word/document.xml#0.0.8',
      modelTextBefore: '0123456789',
      modelTextAfter: `0123456789${'x'.repeat(12)}`,
      paintedTextBefore: '0123456789',
      paintedTextAfter: `0123456789${'x'.repeat(12)}`,
      paintedInsertionOffset: 10,
      perKeyGrowth: Array.from({ length: 12 }, () => 1),
      trustedBeforeInputCount: 12,
      perKeyRevisionAdvance: Array.from({ length: 12 }, () => true),
      probeSamples: Array.from({ length: 12 }, (_, index) => ({
        ms: 10,
        revisionBefore: index + 3,
        revisionAfter: index + 4,
        validationRecordedAtMs: null,
      })),
    });
    expect(valid.valid).toBe(true);
    expect(valid.evidence.layout).toBe(true);
  });

  test('fails when opened pages differ from the manifest count', () => {
    const invalid = evaluateTypingRun({
      pages: 520,
      expectedPages: 521,
      beforeLength: 10,
      afterLength: 22,
      keys: 12,
      layoutRevisionBefore: 1,
      layoutRevisionAfter: 13,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: [],
      caretOffsetBefore: { paragraphId: 'p', offset: 0 },
      caretOffsetAfter: { paragraphId: 'p', offset: 12 },
      expectedCaretParagraphId: 'p',
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons.some((reason) => reason.includes('expected exactly 521'))).toBe(true);
  });

  test('missing caret evidence invalidates the run', () => {
    const invalid = evaluateTypingRun({
      pages: 521,
      expectedPages: 521,
      beforeLength: 10,
      afterLength: 22,
      keys: 12,
      layoutRevisionBefore: 1,
      layoutRevisionAfter: 13,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: [],
      caretOffsetBefore: null,
      caretOffsetAfter: { paragraphId: 'p', offset: 12 },
      expectedCaretParagraphId: 'p',
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons.some((reason) => reason.includes('caret offset before'))).toBe(true);
  });

  test('any page error invalidates the run', () => {
    expect(hasAuditErrors([], ['ReferenceError: x is not defined'])).toBe(true);
    const invalid = evaluateTypingRun({
      pages: 521,
      expectedPages: 521,
      beforeLength: 10,
      afterLength: 22,
      keys: 12,
      layoutRevisionBefore: 1,
      layoutRevisionAfter: 13,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: ['ReferenceError: x is not defined'],
      caretOffsetBefore: { paragraphId: 'p', offset: 0 },
      caretOffsetAfter: { paragraphId: 'p', offset: 12 },
      expectedCaretParagraphId: 'p',
    });
    expect(invalid.valid).toBe(false);
  });

  test('console errors invalidate the run but warnings do not count as errors', () => {
    expect(hasConsoleErrors([{ type: 'error', text: 'layout failed' }])).toBe(true);
    expect(hasConsoleErrors([{ type: 'warning', text: 'layout failed' }])).toBe(false);
    const invalid = evaluateTypingRun({
      pages: 521,
      expectedPages: 521,
      beforeLength: 10,
      afterLength: 22,
      beforeModelLength: 10,
      afterModelLength: 22,
      keys: 12,
      layoutRevisionBefore: 1,
      layoutRevisionAfter: 13,
      caretInPagesLayer: true,
      consoleErrors: [
        { type: 'warning', text: 'noisy warning' },
        { type: 'error', text: 'layout failed' },
        { type: 'info', text: 'vite connected' },
      ],
      pageErrors: [],
      caretOffsetBefore: { paragraphId: 'p', offset: 10 },
      caretOffsetAfter: { paragraphId: 'p', offset: 22 },
      expectedCaretParagraphId: 'p',
      modelTextBefore: 'hello world',
      modelTextAfter: `hello world${'x'.repeat(12)}`,
      paintedTextBefore: 'hello world',
      paintedTextAfter: `hello world${'x'.repeat(12)}`,
      insertionOffset: 10,
      paintedInsertionOffset: 10,
      perKeyGrowth: Array.from({ length: 12 }, () => 1),
      trustedBeforeInputCount: 12,
      perKeyRevisionAdvance: Array.from({ length: 12 }, () => true),
      probeSamples: Array.from({ length: 12 }, (_, index) => ({
        ms: 1,
        revisionBefore: index,
        revisionAfter: index + 1,
        validationRecordedAtMs: null,
      })),
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons.some((reason) => reason.includes('1 console error(s)'))).toBe(true);
    expect(invalid.reasons.some((reason) => reason.includes('3 console error(s)'))).toBe(false);
  });

  test('requires canonical model and painted text at the insertion offset', () => {
    const invalid = evaluateTypingRun({
      pages: 521,
      expectedPages: 521,
      beforeLength: 10,
      afterLength: 22,
      beforeModelLength: 10,
      afterModelLength: 22,
      keys: 12,
      layoutRevisionBefore: 1,
      layoutRevisionAfter: 13,
      caretInPagesLayer: true,
      consoleErrors: [],
      pageErrors: [],
      caretOffsetBefore: { paragraphId: 'p', offset: 10 },
      caretOffsetAfter: { paragraphId: 'p', offset: 22 },
      expectedCaretParagraphId: 'p',
      modelTextBefore: 'hello world',
      modelTextAfter: 'hello-y-y-y-y-y-y-y-y-y-y-y-y',
      paintedTextBefore: 'hello world',
      paintedTextAfter: 'hello-y-y-y-y-y-y-y-y-y-y-y-y',
      insertionOffset: 10,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons.some((reason) => reason.includes('inserted characters'))).toBe(true);
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
    expect(
      validateTypingProbeSample({
        ms: 12.5,
        revisionBefore: 3,
        revisionAfter: 4,
        validationRecordedAtMs: null,
      })
    ).toBe(true);
    expect(
      validateTypingProbeSample({
        ms: -1,
        revisionBefore: 3,
        revisionAfter: 4,
        validationRecordedAtMs: null,
      })
    ).toBe(false);
    expect(
      validateTypingProbeSample({
        ms: 12.5,
        revisionBefore: 4,
        revisionAfter: 4,
        validationRecordedAtMs: null,
      })
    ).toBe(false);
    expect(
      validateTypingProbeSamples(
        [
          { ms: 1, revisionBefore: 1, revisionAfter: 2, validationRecordedAtMs: null },
          { ms: 2, revisionBefore: 2, revisionAfter: 3, validationRecordedAtMs: null },
        ],
        2
      )
    ).toBe(true);
  });
});

describe('formatTypingAuditReport', () => {
  test('omits latency metrics for invalid runs', () => {
    const verdict = evaluateTypingRun({
      pages: 1,
      expectedPages: 521,
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
    expect(text).not.toContain('2nd animation frame');
  });

  test('prints the responsiveness section when the probe observed slow events', () => {
    const verdict = { valid: true, reasons: [], paragraphGrowth: 2 };
    const base = {
      url: 'http://localhost:5173/',
      opened: { pages: 521, paragraphs: 12820 },
      beforeLength: 10,
      afterLength: 12,
      sortedSamples: [10, 20],
      consoleErrors: [],
      pageErrors: [],
    };
    const withEvents = formatTypingAuditReport(verdict, parseTypingUrlAuditArgs([]), {
      ...base,
      responsiveness: {
        slowInputCount: 3,
        worstInputDelayMs: 86.4,
        worstEventDurationMs: 117.2,
        longTaskCount: 2,
        worstLongTaskMs: 211.9,
      },
    });
    expect(withEvents).toContain('slow input events (>=16 ms duration): 3');
    expect(withEvents).toContain('worst input delay 86.4 ms');
    expect(withEvents).toContain('long tasks: 2, worst 211.9 ms');

    const quiet = formatTypingAuditReport(verdict, parseTypingUrlAuditArgs([]), {
      ...base,
      responsiveness: null,
    });
    expect(quiet).toContain('no input event crossed 16 ms');

    const absent = formatTypingAuditReport(verdict, parseTypingUrlAuditArgs([]), base);
    expect(absent).not.toContain('slow input events');
    expect(absent).not.toContain('no input event crossed');
  });
});

describe('summarizeResponsiveness', () => {
  test('null when neither observer captured anything', () => {
    expect(summarizeResponsiveness([], [])).toBeNull();
  });

  test('aggregates counts and worst values across both observers', () => {
    const summary = summarizeResponsiveness(
      [
        { inputDelayMs: 4.2, durationMs: 24 },
        { inputDelayMs: 86.4, durationMs: 117.2 },
      ],
      [55.5, 211.9]
    );
    expect(summary).toEqual({
      slowInputCount: 2,
      worstInputDelayMs: 86.4,
      worstEventDurationMs: 117.2,
      longTaskCount: 2,
      worstLongTaskMs: 211.9,
    });
  });

  test('long tasks alone still produce a summary', () => {
    const summary = summarizeResponsiveness([], [30]);
    expect(summary?.slowInputCount).toBe(0);
    expect(summary?.worstLongTaskMs).toBe(30);
  });
});

describe('formatStructuredInvalid', () => {
  test('preserves full console and page error text', () => {
    const text = formatStructuredInvalid({
      valid: false,
      reasons: ['opened 1 pages, expected exactly 521'],
      detail: 'navigation failed',
      consoleErrors: [
        { type: 'error', text: 'very long console payload that must not be truncated' },
      ],
      pageErrors: ['ReferenceError: full page stack must remain intact'],
    });
    expect(text).toContain('very long console payload that must not be truncated');
    expect(text).toContain('full page stack must remain intact');
  });
});

describe('requireRemainingMs', () => {
  test('returns at least 1 ms while time remains', () => {
    expect(requireRemainingMs(Date.now() + 50)).toBeGreaterThanOrEqual(1);
  });

  test('throws once the global deadline passes', () => {
    expect(() => requireRemainingMs(Date.now() - 1)).toThrow('global deadline exceeded');
  });
});

describe('validateHttpUrlPolicy', () => {
  test('blocks non-loopback http(s) unless allowRemote is set', () => {
    expect(validateHttpUrlPolicy('https://example.com/doc', { allowRemote: false }).allowed).toBe(
      false
    );
    expect(validateHttpUrlPolicy('https://example.com/doc', { allowRemote: true }).allowed).toBe(
      true
    );
    expect(validateHttpUrlPolicy('ws://localhost/socket').allowed).toBe(true);
  });
});

describe('validateProfileWindow', () => {
  test('accepts consistent profile timing windows', () => {
    expect(
      validateProfileWindow({
        startTime: 0,
        endTime: 10_000,
        nodes: [],
        samples: [1, 1],
        timeDeltas: [4_000, 5_000],
      })
    ).toBe(true);
  });

  test('rejects impossible profile timing windows', () => {
    expect(
      validateProfileWindow({
        startTime: 0,
        endTime: 1_000,
        nodes: [],
        samples: [1, 1, 1],
        timeDeltas: [50_000, 50_000, 50_000],
      })
    ).toBe(false);
  });
});

describe('buildProfileReport', () => {
  test('marks invalid profiles without reporting attribution', () => {
    const report = buildProfileReport(
      [
        {
          startTime: 0,
          endTime: 1_000,
          nodes: [],
          samples: [1],
          timeDeltas: [999_999],
        },
      ],
      1,
      5
    );
    expect(report.valid).toBe(false);
    expect(report.lines.join('\n')).toContain('INVALID');
    expect(report.lines.join('\n')).not.toContain('function (file:line)');
  });
});

describe('quantile', () => {
  test('returns null for an empty sample', () => {
    expect(quantile([], 0.5)).toBeNull();
  });
});
