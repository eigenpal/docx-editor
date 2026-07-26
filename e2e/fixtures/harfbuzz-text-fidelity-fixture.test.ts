import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import {
  authoredStateDigest,
  bodyStoryId,
  createStyleResolver,
  parseDocx,
  writeDocx,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';
import { layoutBody, type TextItem } from '@docx-editor.dev/engine-layout';
import { createHarfBuzzLayoutOptions } from '../../packages/engine-layout/test/fixtures/layout-shaping.ts';
import {
  FIDELITY_DOCUMENT_XML,
  FIDELITY_STYLES_XML,
  FIDELITY_THEME_XML,
  createHarfBuzzTextFidelityDocx,
} from './generate-harfbuzz-text-fidelity-fixture.ts';
import { FIDELITY_FONT_HASHES, FIDELITY_PAGE_SUMMARY } from './harfbuzz-fidelity-expected.ts';

function open(bytes: Uint8Array) {
  const result = parseDocx(bytes, { preserveAll: true });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.model;
}

function textItems(model: ReturnType<typeof open>): TextItem[] {
  return layoutBody(
    model,
    createHarfBuzzLayoutOptions({ pageWidth: 6120, pageHeight: 3960, margin: 360 })
  ).pages.flatMap((page) => page.items.filter((item): item is TextItem => item.type === 'text'));
}

describe('generated HarfBuzz text fidelity fixture', () => {
  test('checked-in DOCX exactly matches deterministic source', () => {
    expect(
      new Uint8Array(readFileSync(new URL('./harfbuzz-text-fidelity.docx', import.meta.url)))
    ).toEqual(createHarfBuzzTextFidelityDocx());
  });

  test('resolves direct, inherited, theme, and declared-substitution formatting', () => {
    const model = open(createHarfBuzzTextFidelityDocx());
    const paragraphs = model.stories.get(bodyStoryId(model))!.blocks as ParagraphRecord[];
    const resolver = createStyleResolver(model);
    const resolved = new Map(
      paragraphs.flatMap((paragraph) =>
        paragraph.runs.map((run) => [run.text, resolver.runProps(paragraph, run)] as const)
      )
    );

    expect(resolved.get('AV')).toEqual({
      fonts: { ascii: 'DejaVu Sans', hAnsi: 'DejaVu Sans' },
      sizeHalfPoints: 24,
      color: '202020',
    });
    expect(resolved.get('BoldAV')).toEqual({
      fonts: { ascii: 'DejaVu Sans', hAnsi: 'DejaVu Sans' },
      sizeHalfPoints: 28,
      color: 'C00000',
      bold: true,
    });
    expect(resolved.get('Italic')).toEqual({
      fonts: { ascii: 'DejaVu Sans', hAnsi: 'DejaVu Sans' },
      sizeHalfPoints: 22,
      color: '0066CC',
      italic: true,
    });
    expect(resolved.get('DirectFace')?.fonts).toEqual({
      ascii: 'Declared Missing',
      hAnsi: 'Declared Missing',
    });
    expect(resolved.get('InheritedCharacter')).toEqual({
      fonts: { ascii: 'DejaVu Sans', hAnsi: 'DejaVu Sans' },
      sizeHalfPoints: 30,
      color: '202020',
      bold: true,
      italic: true,
    });
    expect(resolved.get('Major heading')).toEqual({
      fonts: {
        asciiTheme: 'majorAscii',
        hAnsiTheme: 'majorHAnsi',
        ascii: 'Cambria',
        hAnsi: 'Cambria',
      },
      sizeHalfPoints: 40,
      color: '202020',
      bold: true,
    });
    expect(resolved.get('Minor heading')).toEqual({
      fonts: {
        asciiTheme: 'minorAscii',
        hAnsiTheme: 'minorHAnsi',
        ascii: 'Calibri',
        hAnsi: 'Calibri',
      },
      sizeHalfPoints: 32,
      color: '202020',
    });
    expect(resolved.get('سلام')).toEqual({
      fonts: {
        ascii: 'DejaVu Sans',
        hAnsi: 'DejaVu Sans',
        cs: 'DejaVu Sans',
      },
      sizeHalfPoints: 24,
      color: '202020',
    });
  });

  test('uses exact regular and bold glyphs, geometry, bidi, metrics, lines, and pages', () => {
    const layout = layoutBody(
      open(createHarfBuzzTextFidelityDocx()),
      createHarfBuzzLayoutOptions({ pageWidth: 6120, pageHeight: 3960, margin: 360 })
    );
    const items = layout.pages.flatMap((page) =>
      page.items.filter((item): item is TextItem => item.type === 'text')
    );
    const regular = items.find((item) => item.text === 'AV')!;
    const bold = items.find((item) => item.text === 'BoldAV')!;
    const rtl = items.find((item) => item.text === 'سلام')!;
    const exactShape = (text: string) => {
      const item = items.find((candidate) => candidate.text === text)!;
      return {
        glyphs: item.shapedRun.glyphs.map(({ id, cluster, advanceX }) => [id, cluster, advanceX]),
        clusters: item.glyphClusters.map(({ utf16From, utf16To, advance }) => [
          utf16From,
          utf16To,
          advance,
        ]),
        box: [item.x, item.y, item.width, item.height],
        metrics: item.shapedRun.metrics,
        bidiLevel: item.bidiLevel,
      };
    };

    expect(exactShape('AV')).toEqual({
      glyphs: [
        [36, 0, 149],
        [57, 1, 164],
      ],
      clusters: [
        [0, 1, 149],
        [1, 2, 164],
      ],
      box: [360, 360, 313, 326],
      metrics: { ascent: 223, descent: 57, lineGap: 0 },
      bidiLevel: 0,
    });
    expect(exactShape('BoldAV')).toEqual({
      glyphs: [
        [37, 0, 213],
        [82, 1, 192],
        [79, 2, 96],
        [71, 3, 200],
        [36, 4, 198],
        [57, 5, 217],
      ],
      clusters: [
        [0, 1, 213],
        [1, 2, 192],
        [2, 3, 96],
        [3, 4, 200],
        [4, 5, 198],
        [5, 6, 217],
      ],
      box: [673, 360, 1116, 326],
      metrics: { ascent: 260, descent: 66, lineGap: 0 },
      bidiLevel: 0,
    });
    expect(exactShape('Italic')).toEqual({
      glyphs: [
        [44, 0, 65],
        [87, 1, 86],
        [68, 2, 135],
        [79, 3, 61],
        [76, 4, 61],
        [70, 5, 121],
      ],
      clusters: [
        [0, 1, 65],
        [1, 2, 86],
        [2, 3, 135],
        [3, 4, 61],
        [4, 5, 61],
        [5, 6, 121],
      ],
      box: [1789, 360, 529, 326],
      metrics: { ascent: 204, descent: 52, lineGap: 0 },
      bidiLevel: 0,
    });
    expect(exactShape('DirectFace')).toEqual({
      glyphs: [
        [39, 0, 185],
        [76, 1, 67],
        [85, 2, 93],
        [72, 3, 148],
        [70, 4, 132],
        [87, 5, 94],
        [41, 6, 116],
        [68, 7, 147],
        [70, 8, 132],
        [72, 9, 148],
      ],
      clusters: [
        [0, 1, 185],
        [1, 2, 67],
        [2, 3, 93],
        [3, 4, 148],
        [4, 5, 132],
        [5, 6, 94],
        [6, 7, 116],
        [7, 8, 147],
        [8, 9, 132],
        [9, 10, 148],
      ],
      box: [2318, 360, 1262, 326],
      metrics: { ascent: 223, descent: 57, lineGap: 0 },
      bidiLevel: 0,
    });
    expect(exactShape('InheritedCharacter')).toEqual({
      glyphs: [
        [44, 0, 112],
        [81, 1, 214],
        [75, 2, 214],
        [72, 3, 203],
        [85, 4, 148],
        [76, 5, 103],
        [87, 6, 143],
        [72, 7, 203],
        [71, 8, 215],
        [38, 9, 220],
        [75, 10, 214],
        [68, 11, 202],
        [85, 12, 148],
        [68, 13, 202],
        [70, 14, 178],
        [87, 15, 143],
        [72, 16, 203],
        [85, 17, 148],
      ],
      clusters: [
        [0, 1, 112],
        [1, 2, 214],
        [2, 3, 214],
        [3, 4, 203],
        [4, 5, 148],
        [5, 6, 103],
        [6, 7, 143],
        [7, 8, 203],
        [8, 9, 215],
        [9, 10, 220],
        [10, 11, 214],
        [11, 12, 202],
        [12, 13, 148],
        [13, 14, 202],
        [14, 15, 178],
        [15, 16, 143],
        [16, 17, 203],
        [17, 18, 148],
      ],
      box: [360, 686, 3213, 349],
      metrics: { ascent: 278, descent: 71, lineGap: 0 },
      bidiLevel: 0,
    });
    expect(exactShape('Major heading')).toEqual({
      glyphs: [
        [48, 0, 398],
        [68, 1, 270],
        [77, 2, 137],
        [82, 3, 275],
        [85, 4, 197],
        [3, 5, 139],
        [75, 6, 285],
        [72, 7, 271],
        [68, 8, 270],
        [71, 9, 286],
        [76, 10, 137],
        [81, 11, 285],
        [74, 12, 286],
      ],
      clusters: [
        [0, 1, 398],
        [1, 2, 270],
        [2, 3, 137],
        [3, 4, 275],
        [4, 5, 197],
        [5, 6, 139],
        [6, 7, 285],
        [7, 8, 271],
        [8, 9, 270],
        [9, 10, 286],
        [10, 11, 137],
        [11, 12, 285],
        [12, 13, 286],
      ],
      box: [360, 1035, 3236, 465],
      metrics: { ascent: 371, descent: 94, lineGap: 0 },
      bidiLevel: 0,
    });
    expect(exactShape('Minor heading')).toEqual({
      glyphs: [
        [48, 0, 276],
        [76, 1, 89],
        [81, 2, 203],
        [82, 3, 196],
        [85, 4, 132],
        [3, 5, 102],
        [75, 6, 203],
        [72, 7, 197],
        [68, 8, 196],
        [71, 9, 203],
        [76, 10, 89],
        [81, 11, 203],
        [74, 12, 203],
      ],
      clusters: [
        [0, 1, 276],
        [1, 2, 89],
        [2, 3, 203],
        [3, 4, 196],
        [4, 5, 132],
        [5, 6, 102],
        [6, 7, 203],
        [7, 8, 197],
        [8, 9, 196],
        [9, 10, 203],
        [10, 11, 89],
        [11, 12, 203],
        [12, 13, 203],
      ],
      box: [360, 1500, 2292, 372],
      metrics: { ascent: 297, descent: 75, lineGap: 0 },
      bidiLevel: 0,
    });
    expect(exactShape('سلام')).toEqual({
      glyphs: [
        [1390, 3, 149],
        [5366, 1, 143],
        [5293, 0, 201],
      ],
      clusters: [
        [3, 4, 149],
        [1, 3, 143],
        [0, 1, 201],
      ],
      box: [360, 1872, 493, 280],
      metrics: { ascent: 223, descent: 57, lineGap: 0 },
      bidiLevel: 1,
    });
    expect(
      regular.glyphClusters.map(({ utf16From, utf16To, advance, caretEdges }) => ({
        utf16From,
        utf16To,
        advance,
        caretEdges,
      }))
    ).toEqual([
      { utf16From: 0, utf16To: 1, advance: 149, caretEdges: [0, 149] },
      { utf16From: 1, utf16To: 2, advance: 164, caretEdges: [0, 164] },
    ]);
    expect(regular.bidiLevel).toBe(0);
    expect(rtl.bidiLevel).toBe(1);
    expect(rtl.direction).toBe('rtl');
    expect(regular.shapedRun.metrics).toEqual({ ascent: 223, descent: 57, lineGap: 0 });
    expect(regular.shapingEnvironment.font.hash).toBe(FIDELITY_FONT_HASHES.regular);
    expect(bold.shapingEnvironment.font.hash).toBe(FIDELITY_FONT_HASHES.bold);
    expect(regular.width).toBe(313);
    expect(bold.x).toBe(regular.x + regular.width);
    expect(layout.pages.length).toBe(FIDELITY_PAGE_SUMMARY.layoutPageCount);
    expect(new Set(items.map((item) => item.line.lineId)).size).toBe(
      FIDELITY_PAGE_SUMMARY.layoutLineCount
    );
    expect(
      layout.pages.map(
        (page) =>
          new Set(
            page.items
              .filter((item): item is TextItem => item.type === 'text')
              .map((item) => item.line.lineId)
          ).size
      )
    ).toEqual(FIDELITY_PAGE_SUMMARY.layoutLinesPerPage);
    const firstWrapId = items.find((item) => item.text.startsWith('Wrapping line 01'))!.anchor
      .paragraphId;
    expect(
      items
        .filter((item) => item.anchor.paragraphId === firstWrapId)
        .map((item) => ({
          text: item.text,
          page: layout.pages.findIndex((page) => page.items.includes(item)),
          lineIndex: item.line.lineIndex,
          box: [item.x, item.y, item.width, item.height],
        }))
    ).toEqual(
      FIDELITY_PAGE_SUMMARY.firstWrap.lines.map((text, lineIndex) => ({
        text,
        page: 0,
        lineIndex,
        box: FIDELITY_PAGE_SUMMARY.firstWrap.boxes[lineIndex],
      }))
    );
  });

  test('save and reopen preserve formatting part bytes and resolved/layout equivalence', () => {
    const source = createHarfBuzzTextFidelityDocx();
    const before = open(source);
    const saved = writeDocx(before);
    const reopened = open(saved);
    const parts = unzipSync(saved);

    expect(strFromU8(parts['word/document.xml']!)).toBe(FIDELITY_DOCUMENT_XML);
    expect(strFromU8(parts['word/styles.xml']!)).toBe(FIDELITY_STYLES_XML);
    expect(strFromU8(parts['word/theme/theme1.xml']!)).toBe(FIDELITY_THEME_XML);
    expect(authoredStateDigest(reopened)).toBe(authoredStateDigest(before));
    expect(textItems(reopened)).toEqual(textItems(before));
  });
});
