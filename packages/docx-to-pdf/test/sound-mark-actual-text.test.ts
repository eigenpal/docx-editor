/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A kana and the combining sound mark (U+3099, U+309A) that its face joins with it draw one
// glyph. The PDF text of that pair is the precomposed character, also when the mark sits in a
// run of its own. A mark in a cell of its own keeps its own character.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';
import { composeJoinedPairs, composeSoundMarks } from '../src/sound-mark-text.ts';

const VOICED = '\u3099';
const SEMI_VOICED = '\u309a';

function source(file: string, family: string) {
  const bytes = new Uint8Array(
    readFileSync(new URL(`../../core/src/layout/__tests__/fixtures/fonts/${file}`, import.meta.url))
  );
  const made = createFontSource(bytes, { family, weight: 400, style: 'normal' });
  if ('failure' in made) throw new Error(JSON.stringify(made.failure));
  return made.source;
}
const SPACING = 'Mark Spacing';
const JOINING = 'Mark Joining';
const sources = [
  source('sound-mark-spacing.ttf', SPACING),
  source('sound-mark-joining.ttf', JOINING),
];

const run = (family: string, text: string) =>
  `<w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:eastAsia="${family}"/>` +
  `<w:sz w:val="48"/><w:lang w:eastAsia="ja-JP"/></w:rPr><w:t>${text}</w:t></w:r>`;

const decode = (hex: string) =>
  String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((unit) => parseInt(unit, 16)));

/**
 * The ActualText of every region on the page, in content stream order, and the text each glyph
 * code maps to in the fonts' ToUnicode tables, which a reader that ignores ActualText uses.
 */
async function extract(body: string): Promise<{ regions: string[]; glyphTexts: string[] }> {
  const result = await exportPdf(docx(`<w:p>${body}</w:p>`), {
    useSystemFonts: false,
    fonts: { sources },
  });
  const pdf = await PDFDocument.load(result.bytes);
  const streams = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    );
  const page = streams.filter((text) => text.includes(' Tm ')).join('\n');
  const cmaps = streams.filter((text) => text.includes('begincmap')).join('\n');
  return {
    regions: [...page.matchAll(/\/ActualText <FEFF([0-9A-Fa-f]*)>/g)].map(([, hex]) =>
      decode(hex!)
    ),
    glyphTexts: [...cmaps.matchAll(/<[0-9A-Fa-f]{4}> <([0-9A-Fa-f]+)>/g)].map(([, hex]) =>
      decode(hex!)
    ),
  };
}
const regions = async (body: string) => (await extract(body)).regions;

describe('the PDF text of a kana and a sound mark that joins it is the precomposed character', () => {
  test('a face that joins the pair in one glyph', async () => {
    const { regions, glyphTexts } = await extract(run(JOINING, `か${VOICED}あ`));
    expect(regions.join('')).toBe('があ');
    // The one glyph reads as the precomposed character without ActualText too.
    expect(glyphTexts).toContain('が');
  });

  test('a joined mark in a run of its own, drawn over its base', async () => {
    const { regions, glyphTexts } = await extract(run(JOINING, 'か') + run(JOINING, `${VOICED}あ`));
    expect(regions.join('')).toBe('があ');
    // The mark's own glyph sits in a region with no text, so it is not read again.
    expect(regions).toContain('');
    // Without ActualText, the base reads as the kana and the mark as the mark: never twice.
    expect(glyphTexts).toContain('か');
    expect(glyphTexts).not.toContain('が');
  });

  test('a mark that a face draws in a cell of its own keeps its own character', async () => {
    const texts = await regions(run(SPACING, `か${VOICED}あ`));
    expect(texts.join('')).toBe(`か${VOICED}あ`);
  });
});

describe('composeJoinedPairs and composeSoundMarks', () => {
  const run = (text: string, glyphs: number[][]) => ({
    text,
    clusters: glyphs.map(([textStart, textEnd, glyphStart, glyphEnd]) => ({
      textStart: textStart!,
      textEnd: textEnd!,
      glyphStart: glyphStart!,
      glyphEnd: glyphEnd!,
    })),
  });

  test('a pair composes only where the shaper drew it as one glyph', () => {
    const text = `\u306f${SEMI_VOICED}\u304b${VOICED}`;
    expect(
      composeJoinedPairs(
        text,
        run(text, [
          [0, 2, 0, 1],
          [2, 4, 1, 3],
        ])
      )
    ).toBe(`\u3071\u304b${VOICED}`);
    expect(composeJoinedPairs(text, undefined)).toBe(text);
  });

  test('a mark that opens a span joins the base before it only where it draws over it', () => {
    expect(composeSoundMarks(['\u304b', VOICED, '\u3042'], () => true)).toEqual({
      texts: ['\u304c', '', '\u3042'],
      absorbed: new Set([1]),
    });
    expect(composeSoundMarks(['\u304b', `${VOICED}\u3042`], () => false).texts).toEqual([
      '\u304b',
      `${VOICED}\u3042`,
    ]);
    // \u3042 has no voiced form.
    expect(composeSoundMarks(['\u3042', VOICED], () => true).texts).toEqual(['\u3042', VOICED]);
  });
});
