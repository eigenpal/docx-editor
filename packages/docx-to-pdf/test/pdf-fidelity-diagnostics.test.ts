/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  createFidelityDiagnosticCollector,
  pdfApproximationDiagnostic,
  pdfUnsupportedDiagnostic,
} from '../src/pdf-fidelity-diagnostics.ts';
import { HARD_MAX_FIDELITY_DIAGNOSTICS } from '../src/pdf-paint-bounds.ts';

describe('fidelity diagnostic collector', () => {
  test('aggregates repeated table diagnostics on the same page', () => {
    const collector = createFidelityDiagnosticCollector();
    collector.push(
      pdfUnsupportedDiagnostic({
        feature: 'table',
        pageIndex: 0,
        recordKind: 'tableFragment',
        recordId: 'tbl-1',
        reason: 'Table painting is not encoded in the PDF paint slice yet',
      })
    );
    collector.push(
      pdfUnsupportedDiagnostic({
        feature: 'table',
        pageIndex: 0,
        recordKind: 'tableFragment',
        recordId: 'tbl-2',
        reason: 'Table painting is not encoded in the PDF paint slice yet',
      })
    );

    expect(collector.snapshot()).toEqual([
      expect.objectContaining({
        feature: 'table',
        pageIndex: 0,
        recordKind: 'tableFragment',
        reason: 'Table painting is not encoded in the PDF paint slice yet (2 occurrences)',
      }),
    ]);
  });

  test('deduplicates standard-font substitutions by page and requested face', () => {
    const collector = createFidelityDiagnosticCollector();
    const arialPage0 = pdfApproximationDiagnostic({
      feature: 'standard-font-substitution',
      pageIndex: 0,
      recordKind: 'textSpan',
      recordId: 'Arial',
      reason: 'Substituted PDF built-in font Helvetica for "Arial"',
    });
    collector.push(arialPage0);
    collector.push(arialPage0);
    collector.push(
      pdfApproximationDiagnostic({
        feature: 'standard-font-substitution',
        pageIndex: 1,
        recordKind: 'textSpan',
        recordId: 'Arial',
        reason: 'Substituted PDF built-in font Helvetica for "Arial"',
      })
    );
    collector.push(
      pdfApproximationDiagnostic({
        feature: 'standard-font-substitution',
        pageIndex: 0,
        recordKind: 'textSpan',
        recordId: 'Calibri',
        reason: 'Substituted PDF built-in font Helvetica for "Calibri"',
      })
    );

    const snapshot = collector.snapshot();
    expect(snapshot).toHaveLength(3);
    expect(
      snapshot.find((entry) => entry.pageIndex === 0 && entry.recordId === 'Arial')?.reason
    ).toContain('(2 occurrences)');
    expect(snapshot.some((entry) => entry.pageIndex === 1 && entry.recordId === 'Arial')).toBe(
      true
    );
    expect(snapshot.some((entry) => entry.recordId === 'Calibri')).toBe(true);
  });

  test('caps unique keys and appends one diagnostic-limit overflow entry', () => {
    const collector = createFidelityDiagnosticCollector();
    for (let index = 0; index < HARD_MAX_FIDELITY_DIAGNOSTICS + 5; index += 1) {
      collector.push(
        pdfUnsupportedDiagnostic({
          feature: `feature-${index}`,
          pageIndex: 0,
          recordKind: 'document',
          reason: `unique ${index}`,
        })
      );
    }

    const snapshot = collector.snapshot();
    expect(snapshot).toHaveLength(HARD_MAX_FIDELITY_DIAGNOSTICS);
    const overflow = snapshot.find((entry) => entry.feature === 'diagnostic-limit');
    expect(overflow).toMatchObject({
      kind: 'unsupported',
      recordKind: 'document',
    });
    expect(overflow?.reason).toContain('Omitted 6 additional fidelity diagnostics');
  });
});
