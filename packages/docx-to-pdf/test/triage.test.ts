/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { compareReports, fontGaps, groupDiagnostics, type TriageRow } from '../scripts/triage.ts';

test('diagnostics group by code with pages, distinct messages and the largest group first', () => {
  const groups = groupDiagnostics([
    {
      code: 'drawing',
      message: 'Unsupported drawing: chart',
      pageIndex: 2,
      severity: 'unsupported',
    },
    {
      code: 'drawing',
      message: 'Unsupported drawing: chart',
      pageIndex: 0,
      severity: 'unsupported',
    },
    {
      code: 'drawing',
      message: 'Unsupported drawing: chart',
      pageIndex: 2,
      severity: 'unsupported',
    },
    { code: 'unshaped-text', message: 'in Aptos', pageIndex: 1, severity: 'unsupported' },
    { code: 'underline-metrics', message: 'default', pageIndex: 1, severity: 'information' },
  ]);
  expect(groups.map((g) => [g.code, g.count, g.pages])).toEqual([
    ['drawing', 3, [1, 3]],
    ['underline-metrics', 1, [2]],
    ['unshaped-text', 1, [2]],
  ]);
  expect(groups[0]!.messages).toEqual(['Unsupported drawing: chart']);
});

test('font gaps name the families without full coverage and the faces they lack', () => {
  const gaps = fontGaps({
    requestedFamilies: ['Aptos', 'Arial'],
    defaultFamily: 'Arial',
    families: [
      { family: 'Aptos', coverage: 'none', faces: [] },
      {
        family: 'Symbol',
        coverage: 'partial',
        faces: [{ weight: 400, style: 'normal', via: 'direct' }],
      },
      { family: 'Arial', coverage: 'complete', faces: [] },
    ],
    originFailures: [],
    droppedEmbeddedFonts: [],
  } as never);
  expect(gaps).toEqual([
    {
      family: 'Aptos',
      coverage: 'none',
      missing: ['400/normal', '700/normal', '400/italic', '700/italic'],
    },
    { family: 'Symbol', coverage: 'partial', missing: ['700/normal', '400/italic', '700/italic'] },
  ]);
});

test('a report comparison lists documents that got worse and better', () => {
  const row = (name: string, status: TriageRow['status'], codes: string[]): TriageRow => ({
    name,
    status,
    ms: 0,
    groups: codes.map((code) => ({
      code,
      severity: 'unsupported',
      count: 1,
      pages: [],
      messages: [],
    })),
    fonts: [],
  });
  const { worse, better } = compareReports(
    [row('a', 'best-effort', ['drawing']), row('b', 'strict', []), row('c', 'best-effort', ['x'])],
    [row('a', 'strict', []), row('b', 'best-effort', ['textbox']), row('c', 'best-effort', ['x'])]
  );
  expect(better).toEqual(['a: best-effort → strict -drawing']);
  expect(worse).toEqual(['b: strict → best-effort +textbox']);
});
