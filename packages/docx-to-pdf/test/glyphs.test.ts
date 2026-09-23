/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { openFontBackedDocumentForExport } from '@docx-editor.dev/core/export';
import { forEachSemanticSpan } from '@docx-editor.dev/core/layout';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';
function font(path: string, family: string) {
  const source = createFontSource(new Uint8Array(readFileSync(new URL(path, import.meta.url))), {
    family,
    weight: 400,
    style: 'normal',
  });
  if ('failure' in source) throw new Error(JSON.stringify(source.failure));
  return { sources: [source.source], defaultFont: { family, sizeHalfPoints: 22 } };
}
const cases = [
  {
    text: 'office a\u0301 😀',
    family: 'DejaVu Sans',
    path: '../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
  },
  {
    text: 'مرحبا بالعالم',
    family: 'DejaVu Sans',
    path: '../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
  },
  {
    text: 'नमस्ते हिन्दी क्षि',
    family: 'Noto Sans Devanagari',
    path: './fixtures/Devanagari.subset.ttf',
  },
  { text: '日本語中文、。', family: 'Noto Sans CJK JP', path: './fixtures/CJK.subset.otf' },
];
test('a single span can embed distinct fallback faces without losing text or glyph origins', async () => {
  const fonts = font(
    '../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
    'DejaVu Sans'
  );
  // No admitted face covers both the mathematical Fraktur letter and this emoji.
  const text = 'A𝕬🦊B';
  const input = docx(
    paragraph(text, '<w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/></w:rPr>')
  );
  const result = await exportPdf(input, { fonts, useSystemFonts: false });
  expect(
    result.diagnostics.filter(
      (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
    )
  ).toEqual([]);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent({ disableNormalization: true });
    const items = content.items.filter((item) => 'str' in item);
    expect(items.map((item) => item.str).join('')).toBe(text);
    // Two embedded text faces: the Fraktur letter's mathematics face beside DejaVu Sans. The
    // emoji is a color face, painted as palette layers and carried on an invisible glyph of
    // the text face rather than embedded.
    expect(
      new Set(items.filter((item) => item.str).map((item) => item.fontName)).size
    ).toBeGreaterThanOrEqual(2);
    // Origins advance on the AUTHORED size while glyphs are drawn on the 0.24pt device
    // grid, so a drawn mark may run up to half a grid step past its own advance. The
    // reference does the same: it emits 11.04 for an 11pt run and still advances on 11pt
    // metrics. Allow that overhang; the ordering is what this asserts.
    for (let index = 1; index < items.length; index++) {
      expect(items[index]!.transform[4]).toBeGreaterThan(items[index - 1]!.transform[4]);
      expect(items[index]!.transform[4]).toBeGreaterThanOrEqual(
        items[index - 1]!.transform[4] + items[index - 1]!.width - 0.15
      );
    }
  } finally {
    await pdf.destroy();
  }
});
for (const entry of cases)
  test(`exact glyph output: ${entry.text}`, async () => {
    const fonts = font(entry.path, entry.family);
    const input = docx(
      paragraph(
        entry.text,
        `<w:rPr><w:rFonts w:ascii="${entry.family}" w:hAnsi="${entry.family}" w:eastAsia="${entry.family}" w:cs="${entry.family}"/></w:rPr>`
      )
    );
    const result = await exportPdf(input, { fonts });
    expect(
      result.diagnostics.filter(
        (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
      )
    ).toEqual([]);
    const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent();
      const text = content.items.map((i) => ('str' in i ? i.str : '')).join('');
      expect(text.normalize('NFC')).toBe(entry.text.normalize('NFC'));
    } finally {
      await pdf.destroy();
    }
  });

test('PDF baseline and glyph origins match the admitted Core shaping run', async () => {
  const fonts = font(
    '../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
    'DejaVu Sans'
  );
  const input = docx(
    paragraph('AV office', '<w:rPr><w:rFonts w:ascii="DejaVu Sans"/><w:sz w:val="32"/></w:rPr>')
  );
  const opened = await openFontBackedDocumentForExport(input, { fonts, displayMode: 'proposed' });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const layout = await opened.session.layout();
    const visits: Parameters<Parameters<typeof forEachSemanticSpan>[1]>[0][] = [];
    forEachSemanticSpan(layout, (v) => visits.push(v));
    const result = await exportPdf(input, { fonts });
    const pdf = await getDocument({ data: result.bytes.slice() }).promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent({ disableNormalization: true });
      const first = content.items.find((i) => 'str' in i && i.str.startsWith('AV'));
      expect(first && 'transform' in first ? first.transform[4] : NaN).toBeCloseTo(
        visits[0]!.absoluteBox.x - visits[0]!.page.box.x,
        2
      );
      const v = visits[0]!;
      // The painted baseline is Core's, taken to the 0.24pt output grid the reference puts
      // every baseline on. Asserting the snapped value still catches drift — anything the
      // exporter invents beyond half a grid step fails — while allowing that one step.
      const grid = 0.24;
      const fromTop = v.storyOrigin.y - v.page.box.y + v.line.box.y + v.line.baseline;
      expect(first && 'transform' in first ? first.transform[5] : NaN).toBeCloseTo(
        v.page.box.height - Math.round(fromTop / grid) * grid,
        2
      );
    } finally {
      await pdf.destroy();
    }
  } finally {
    opened.session.dispose();
  }
});

test('selected TTC face is embedded, not the first collection face', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/Collection.ttc', import.meta.url)));
  const selected = createFontSource(bytes, {
    family: 'Selected collection',
    weight: 400,
    style: 'normal',
    faceIndex: 1,
  });
  if ('failure' in selected) throw new Error(JSON.stringify(selected.failure));
  const result = await exportPdf(
    docx(
      paragraph(
        'Selected face',
        '<w:rPr><w:rFonts w:ascii="Selected collection" w:hAnsi="Selected collection"/></w:rPr>'
      )
    ),
    {
      fonts: {
        sources: [selected.source],
        defaultFont: { family: 'Selected collection', sizeHalfPoints: 22 },
      },
    }
  );
  expect(
    result.diagnostics.filter(
      (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
    )
  ).toEqual([]);
  expect(
    result.fontResolution.families.some((f) => f.faces.some((face) => face.faceIndex === 1))
  ).toBe(true);
  const pdf = await getDocument({ data: result.bytes.slice() }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((i) => ('str' in i ? i.str : '')).join('')).toBe('Selected face');
  } finally {
    await pdf.destroy();
  }
});
