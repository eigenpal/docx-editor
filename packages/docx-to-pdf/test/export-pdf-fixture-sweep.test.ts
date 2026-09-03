/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// PR #707 reviewer gate: exportPdf must not throw on supported corpus fixtures.
//
// The sweep is bounded to `e2e/fixtures/*.docx` and uses best-effort fidelity so ordinary exporter
// crashes surface here. Only fixtures on the explicit allowlist below are excluded from the
// must-not-throw requirement; every other `.docx` in the directory is in scope.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportPdf, PdfDocumentOpenError } from '../src/index.ts';

const FIXTURES = resolve(import.meta.dir, '../../../e2e/fixtures');

/** Fixtures excluded from the must-not-throw sweep, with a documented reason for each. */
const FIXTURE_ALLOWLIST = {
  'textbox-test.docx': {
    category: 'malformed',
    reason:
      'Undeclared namespace prefix in document.xml; Core rejects at the bounded parse boundary.',
    expectRejection: 'document-open' as const,
  },
  'typing-perf-521pp.docx': {
    category: 'oversized',
    reason:
      '521-page typing-latency benchmark with a pinned manifest; owned by perf and parity tests.',
  },
  'issue-68-large.docx': {
    category: 'oversized',
    reason:
      '307-page review-scale document; one export dominates corpus runtime under the test runner.',
  },
  'issue-68-large-comments-suggestions.docx': {
    category: 'oversized',
    reason: 'Large comments-and-suggestions variant on the same scale as issue-68-large.docx.',
  },
  'synthetic-long-edit.docx': {
    category: 'oversized',
    reason:
      'Collaboration keystroke bench fixture; export cost is out of band for a whole-corpus sweep.',
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly category: 'malformed' | 'encrypted' | 'oversized' | 'rejection';
      readonly reason: string;
      readonly expectRejection?: 'document-open';
    }
  >
>;

type AllowlistedFixture = keyof typeof FIXTURE_ALLOWLIST;

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, name)));
}

function pdfLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/**
 * Bun's default 5 s timeout is too tight for a whole-corpus export sweep.
 *
 * Ninety-ish supported fixtures export in about one minute alone and two minutes under the
 * repository worker pool. The ceiling is about hanging, not load.
 */
const CORPUS_SWEEP_TIMEOUT_MS = 180_000;

describe('exportPdf fixture sweep', () => {
  test(
    'every supported e2e fixture exports without throwing',
    async () => {
      const fixtures = readdirSync(FIXTURES)
        .filter((name) => name.endsWith('.docx'))
        .sort();
      expect(fixtures.length).toBeGreaterThan(50);

      const allowlisted = new Set(Object.keys(FIXTURE_ALLOWLIST));
      const inScope = fixtures.filter((name) => !allowlisted.has(name));
      expect(inScope.length + allowlisted.size).toBe(fixtures.length);

      const failures: { fixture: string; error: string }[] = [];
      for (const fixture of inScope) {
        try {
          const result = await exportPdf(fixtureBytes(fixture));
          const pdf = pdfLatin1(result.bytes);
          expect(result.pageCount).toBeGreaterThan(0);
          expect(result.bytes.byteLength).toBeGreaterThan(0);
          expect(pdf.startsWith('%PDF-')).toBe(true);
          expect(pdf).toContain('%%EOF');
        } catch (error) {
          failures.push({
            fixture,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} fixture(s) crashed exportPdf:\n\n` +
            `${failures.map((failure) => `${failure.fixture}\n  ${failure.error}`).join('\n\n')}\n`
        );
      }
    },
    CORPUS_SWEEP_TIMEOUT_MS
  );

  test('allowlisted malformed fixtures reject at document open', async () => {
    for (const [fixture, entry] of Object.entries(FIXTURE_ALLOWLIST)) {
      if (!('expectRejection' in entry) || entry.expectRejection !== 'document-open') continue;
      const error = await exportPdf(fixtureBytes(fixture)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PdfDocumentOpenError);
      expect((error as PdfDocumentOpenError).reason).toBe('undeclared-prefix');
    }
  });

  test('allowlist entries stay in sync with the fixture directory', () => {
    const fixtures = new Set(readdirSync(FIXTURES).filter((name) => name.endsWith('.docx')));
    for (const fixture of Object.keys(FIXTURE_ALLOWLIST) as AllowlistedFixture[]) {
      expect(fixtures.has(fixture)).toBe(true);
    }
  });
});
