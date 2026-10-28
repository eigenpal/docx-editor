/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mergeEquationText } from '../src/equation-text-merge.ts';
import type { EmbeddedFace } from '../src/fonts.ts';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const widths: Record<string, number> = { '0001': 500, '0002': 778, '0003': 444 };
const face = (name: string) =>
  ({ name, declaredWidth: (code: string) => widths[code] ?? 0 }) as unknown as EmbeddedFace;
const F1 = face('F1');
const F2 = face('F2');

const show = (x: number, parts: string, fontName = 'F1', y = 700, fill = '0 0 0 rg') =>
  [fill, 'BT', `/${fontName} 12 Tf`, `1 0 0 1 ${x} ${y} Tm ${parts}`, 'ET'].join('\n');

/** Every glyph's pen position, as a viewer places it. */
function glyphPositions(painted: readonly string[]): string[] {
  const placed: string[] = [];
  for (const item of painted) {
    const lines = item.split('\n');
    const fontName = /^\/(\S+) (\S+) Tf$/.exec(lines[2] ?? '')?.[1];
    const font = fontName === 'F1' ? F1 : F2;
    const matrix = /^1 0 0 1 (\S+) (\S+) Tm (.*)$/.exec(lines[3] ?? '');
    if (!matrix) continue;
    let pen = Number(matrix[1]);
    for (const part of matrix[3]!.match(/<[0-9A-F]+>|-?[0-9.]+/g) ?? []) {
      if (part.startsWith('<')) {
        placed.push(`${fontName}:${part}@${pen.toFixed(4)},${matrix[2]}`);
        pen += (font.declaredWidth(part.slice(1, -1)) / 1000) * 12;
      } else pen -= (Number(part) / 1000) * 12;
    }
  }
  return placed;
}

test('merges text objects of one face and baseline without moving a glyph', () => {
  const painted = [
    show(100, '<0001> Tj'),
    // A 2.5 pt gap after the first glyph's 6 pt advance.
    show(108.5, '[<0002><0003>] TJ'),
    show(130, '[<0001>-120<0003>] TJ'),
  ];
  const merged = mergeEquationText(painted, [F1, F2]);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.match(/ Tm /g)).toHaveLength(1);
  expect(glyphPositions(merged)).toEqual(glyphPositions(painted));
});

test('keeps text objects apart across a face, a baseline, a colour, or a rule', () => {
  const painted = [
    show(100, '<0001> Tj'),
    show(110, '<0001> Tj', 'F2'),
    show(120, '<0001> Tj', 'F2', 690),
    show(130, '<0001> Tj', 'F2', 690, '1 0 0 rg'),
    '0 0 0 rg 1 2 3 4 re f',
    show(140, '<0001> Tj', 'F2', 690, '1 0 0 rg'),
  ];
  expect(mergeEquationText(painted, [F1, F2])).toEqual(painted);
});

test('a long numeric TJ body parses in linear time', () => {
  // The shape a backtracking pattern spent exponential time on.
  const body = `[${'.'.repeat(50_000)}!] TJ`;
  const painted = ['0 0 0 rg', 'BT', '/F1 12 Tf', `! 0 ! ! ! ! Tm ${body}`, 'ET'].join('\n');
  const started = performance.now();
  expect(mergeEquationText([painted, painted], [F1])).toEqual([painted, painted]);
  expect(performance.now() - started).toBeLessThan(200);
});

test('adjacent numbers in a TJ body refuse the merge', () => {
  const first = show(100, '[<0001>12-3<0002>] TJ');
  const second = show(120, '<0003> Tj');
  expect(mergeEquationText([first, second], [F1])).toEqual([first, second]);
});

test('a text object that opens with a number is not merged after an adjustment', () => {
  const first = show(100, '<0001> Tj');
  const second = show(120, '[25<0002>] TJ');
  expect(mergeEquationText([first, second], [F1])).toEqual([first, second]);
});

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

test('an equation with spaced operators writes one text object per face and baseline', async () => {
  const runs = ['a', '+', 'b', '−', 'c', '=', 'd'].map((t) => `<m:r><m:t>${t}</m:t></m:r>`);
  const bytes = docx(`<w:p xmlns:m="${M}"><m:oMath>${runs.join('')}</m:oMath></w:p>`);
  const result = await exportPdf(bytes, { useSystemFonts: false });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const operators = await page.getOperatorList();
    const shows = operators.fnArray.filter((op) => op === OPS.showText).length;
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text.replace(/\s/g, '')).toContain('+');
    // Seven atoms in two faces at most: the letters and the operators.
    expect(shows).toBeLessThanOrEqual(2);
  } finally {
    await pdf.destroy();
  }
});
