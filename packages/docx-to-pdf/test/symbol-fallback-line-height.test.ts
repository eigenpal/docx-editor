/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A symbol the text faces lack draws in the symbol fallback face, Segoe UI Symbol, whose line
// is 1.33 em. Without that face, Noto Sans Symbols 2 draws the glyph with its own advance, and
// the line keeps the box of the face it stands in for rather than its own 1.7 em. Another missing
// symbol family keeps the 1.22 em box of the Symbol face.
import { expect, test } from 'bun:test';
import { forEachSemanticSpan, linesOf } from '@docx-editor.dev/core/layout';
import { standInFonts } from '../src/font-provisioning.ts';
import { openExportSession } from '../src/open-session.ts';
import { docx } from './fixture.ts';

const SEGOE_LINE = { heightEm: 2724 / 2048, baselineEm: 2210 / 2048 };
const SYMBOL_LINE = { heightEm: 2509 / 2048, baselineEm: 2059 / 2048 };

test('the stand-in for the symbol fallback face keeps its line box', async () => {
  const result = await standInFonts({ families: ['Segoe UI Symbol'], defaultFamily: 'Arial' });
  expect(result.substitutions).toHaveLength(4);
  for (const substitution of result.substitutions) {
    expect(substitution.to.family).toBe('Noto Sans Symbols 2');
    expect(substitution.lineMetrics).toEqual(SEGOE_LINE);
  }
  // Other stand-ins keep the box of the face that draws them.
  const other = await standInFonts({ families: ['Sagona'], defaultFamily: 'Arial' });
  expect(other.substitutions.every((s) => s.lineMetrics === undefined)).toBe(true);
});

test('the stand-in for another missing symbol family takes the Symbol line box', async () => {
  const result = await standInFonts({ families: ['Example Symbols'], defaultFamily: 'Arial' });
  expect(result.substitutions).toHaveLength(4);
  for (const substitution of result.substitutions) {
    expect(substitution.to.family).toBe('Noto Sans Symbols 2');
    expect(substitution.lineMetrics).toEqual(SYMBOL_LINE);
  }
});

test('a symbol character from a missing symbol family does not make its line taller', async () => {
  // A `w:sym` (CT_Sym, 17.3.3.30) whose family no source has paints in Noto Sans Symbols 2. Its
  // line keeps the 1.22 em Symbol box, not the stand-in's 1.7 em box.
  const text = (value: string) =>
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>' +
    `<w:t xml:space="preserve">${value}</w:t></w:r>`;
  const sym =
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>' +
    '<w:sym w:font="Example Symbols" w:char="003D"/></w:r>';
  const paragraph = (runs: string) =>
    `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${runs}</w:p>`;
  const body = paragraph(text('abcd')) + paragraph(text('abcd ') + sym + text(' efgh'));
  const opened = await openExportSession(docx(body), { useSystemFonts: false });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const [plain, withSymbol] = linesOf(layout).map((line) => line.box.height);
    expect(withSymbol).toBeCloseTo(12 * SYMBOL_LINE.heightEm, 2);
    expect(withSymbol!).toBeLessThan(12 * 1.5);
    expect(plain!).toBeLessThanOrEqual(withSymbol!);
    const faces = new Set<string>();
    forEachSemanticSpan(layout, (visit) => {
      if (visit.span.text !== '=') return;
      const shaped = opened.session.shapeLaidOutText(visit.span);
      if (shaped) faces.add(shaped.font.family);
    });
    expect([...faces]).toEqual(['Noto Sans Symbols 2']);
  } finally {
    opened.session.dispose();
  }
});

test('a ballot box in a hinted East Asian run sets the symbol face line', async () => {
  const run = (text: string, hint = '') =>
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Noto Sans CJK JP"' +
    `${hint}/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const paragraph = (runs: string) =>
    `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${runs}</w:p>`;
  const body =
    paragraph(run('abcd ')) +
    paragraph(run('abcd ') + run('☐☒', ' w:hint="eastAsia"')) +
    paragraph(run('abcd ☐'));
  const opened = await openExportSession(docx(body), { useSystemFonts: false });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const [plain, hinted, unhinted] = linesOf(layout).map((line) => line.box.height);
    // 11 pt: the symbol face's 1.33 em line, taller than the Arial line.
    expect(hinted).toBeCloseTo(11 * SEGOE_LINE.heightEm, 2);
    expect(unhinted).toBeCloseTo(11 * SEGOE_LINE.heightEm, 2);
    expect(plain!).toBeLessThan(hinted!);
    const faces = new Set<string>();
    forEachSemanticSpan(layout, (visit) => {
      if (!/[☐☒]/.test(visit.span.text)) return;
      const shaped = opened.session.shapeLaidOutText(visit.span);
      for (const font of shaped?.fonts ?? (shaped ? [shaped.font] : []))
        if (font.family !== 'Liberation Sans') faces.add(font.family);
    });
    expect([...faces]).toEqual(['Noto Sans Symbols 2']);
  } finally {
    opened.session.dispose();
  }
});
