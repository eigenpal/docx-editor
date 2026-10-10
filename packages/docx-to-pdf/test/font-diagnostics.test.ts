/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { reportFontDiagnostics } from '../src/font-diagnostics.ts';
import { MAX_OUTPUT_BYTES, Work, PdfWorkLimitError } from '../src/context.ts';

test('font diagnostics retain each source and report incomplete variants', () => {
  const work = new Work(new AbortController().signal);
  const cause = new Error('Source unavailable');
  reportFontDiagnostics(
    {
      requestedFamilies: ['Application Sans'],
      defaultFamily: 'Application Sans',
      originFailures: [
        { originIndex: 0, originName: 'first', cause },
        { originIndex: 1, cause },
      ],
      families: [
        {
          family: 'Application Sans',
          coverage: 'complete',
          faces: [
            { weight: 700, style: 'normal', sourceFamily: 'Application Sans', via: 'substitution' },
          ],
        },
      ],
    },
    work
  );
  expect(work.diagnostics.filter((entry) => entry.code === 'font-origin-failed')).toHaveLength(2);
  expect(work.diagnostics[0]).toMatchObject({
    originIndex: 0,
    originName: 'first',
    message: 'A font source failed: Source unavailable',
  });
  expect(work.diagnostics[1]).toMatchObject({ originIndex: 1 });
  expect(work.diagnostics[2]).toMatchObject({
    code: 'incomplete-font',
    severity: 'information',
    message: 'Font variants use substitute faces from Application Sans; inspect fontResolution',
  });
});

test('diagnostics tolerate unsafe causes and expose one-based page numbers', () => {
  const work = new Work(new AbortController().signal);
  const cause = Object.defineProperty(new Error(), 'message', {
    get() {
      throw new Error('unsafe');
    },
  });
  reportFontDiagnostics(
    {
      requestedFamilies: [],
      defaultFamily: 'Calibri',
      families: [],
      originFailures: [{ originIndex: 0, cause }],
    },
    work
  );
  expect(work.diagnostics[0]?.message).toContain('unknown error');
  work.report('drawing', 'Unsupported drawing', 0);
  expect(work.diagnostics[1]).toMatchObject({ pageIndex: 0, pageNumber: 1 });
  expect(() => work.reserveContent(MAX_OUTPUT_BYTES + 1)).toThrow(PdfWorkLimitError);
});
