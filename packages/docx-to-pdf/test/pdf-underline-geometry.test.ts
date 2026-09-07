/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { FONT_ASSET_ROOT } from '@docx-editor.dev/fonts';
import {
  PDF_STANDARD_UNDERLINE_METRICS,
  WORD_PDF_DEVICE_GRID_PT,
  canMergeSingleUnderlineRuns,
  extendSingleUnderlineRun,
  pdfSingleUnderlineGeometry,
  pdfUnderlineFillRect,
  pdfUnderlineLinkKey,
  pdfUnderlineMetricsFromSfnt,
  quantizeWordPdfDeviceGrid,
  type PdfUnderlineMetrics,
  type PdfUnderlineSegment,
} from '../src/pdf-underline-geometry.ts';
import {
  createPdfPaintPlan,
  pdfBeginPage,
  pdfExternalLink,
  pdfInternalLink,
  pdfTextSpan,
} from '../src/pdf-paint-types.ts';
import { pdfTextStyleFromResolvedRunStyle } from '../src/pdf-text-style.ts';
import { writePdfPaintPlanToBytes } from '../src/pdfkit-paint-writer.ts';

/** Word Garamond Regular `post` table. */
const GARAMOND_METRICS: PdfUnderlineMetrics = Object.freeze({
  unitsPerEm: 2048,
  underlinePosition: -154,
  underlineThickness: 102,
});

/** Word Aptos Regular `post` table. */
const APTOS_METRICS: PdfUnderlineMetrics = Object.freeze({
  unitsPerEm: 2048,
  underlinePosition: -100,
  underlineThickness: 50,
});

const carlitoBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('Carlito-Regular.ttf', FONT_ASSET_ROOT)))
);
const carlitoFont = Object.freeze({
  id: 'test:carlito-underline',
  identity: 'sha256:carlito-underline#0',
  family: 'Carlito',
  request: Object.freeze({ family: 'Carlito', weight: 400 as const, style: 'normal' as const }),
  byteLength: carlitoBytes.byteLength,
  hash: 'sha256:carlito-underline',
  faceIndex: 0,
  bytes: carlitoBytes,
});

function style(overrides: {
  fontFamily?: string | null;
  fontSizePt?: number;
  color?: string | null;
  decoration?: 'none' | 'underline' | 'strike' | 'double-strike';
  italic?: boolean;
  fontWeight?: 'normal' | 'bold';
}) {
  return Object.freeze({
    ...pdfTextStyleFromResolvedRunStyle({
      fontFamily: overrides.fontFamily ?? 'Helvetica',
      fontFamilyEastAsia: null,
      fontSizePt: overrides.fontSizePt ?? 11,
      color: overrides.color ? overrides.color.replace('#', '') : '000000',
      bold: overrides.fontWeight === 'bold',
      italic: overrides.italic ?? false,
      underline: null,
      strike: false,
      doubleStrike: false,
      highlight: null,
      shading: null,
      verticalAlign: 'baseline',
      baselineShiftPt: 0,
      caps: false,
      smallCaps: false,
      characterSpacingPt: 0,
      horizontalScalePercent: 100,
      kerningMinPt: 0,
      hidden: false,
    }),
    ...(overrides.decoration ? { decoration: overrides.decoration } : {}),
    ...(overrides.color !== undefined ? { color: overrides.color } : {}),
  });
}

function segment(overrides: Partial<PdfUnderlineSegment> = {}): PdfUnderlineSegment {
  return Object.freeze({
    pageIndex: 0,
    x: 72,
    width: 40,
    baseline: 708,
    color: '#000000',
    thicknessPt: 0.55,
    offsetTopPt: 1.1,
    linkKey: null,
    ...overrides,
  });
}

function pdfContentStreams(bytes: Uint8Array): string {
  const pdf = Buffer.from(bytes);
  const text = pdf.toString('latin1');
  const streams: string[] = [];
  for (const match of text.matchAll(/\/Filter \/FlateDecode\s*>>\s*stream\n/g)) {
    const start = match.index! + match[0].length;
    const end = text.indexOf('\nendstream', start);
    if (end < 0) continue;
    streams.push(inflateSync(pdf.subarray(start, end)).toString('latin1'));
  }
  return streams.join('\n');
}

function fillRects(content: string): { x: number; y: number; width: number; height: number }[] {
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  const re =
    /([+-]?(?:\d+\.\d*|\.\d+|\d+))\s+([+-]?(?:\d+\.\d*|\.\d+|\d+))\s+([+-]?(?:\d+\.\d*|\.\d+|\d+))\s+([+-]?(?:\d+\.\d*|\.\d+|\d+))\s+re/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const after = content.slice(match.index + match[0].length, match.index + match[0].length + 8);
    if (!/\s*f\b/.test(after)) continue;
    rects.push({
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
    });
  }
  return rects;
}

describe('pdfSingleUnderlineGeometry', () => {
  test('uses continuous Garamond metrics at 11pt, not Word 0.24pt quantization', () => {
    const geometry = pdfSingleUnderlineGeometry(11, GARAMOND_METRICS);
    expect(geometry.thicknessPt).toBeCloseTo(11 * (102 / 2048), 10);
    expect(geometry.offsetTopPt).toBeCloseTo(11 * (154 / 2048), 10);
    expect(quantizeWordPdfDeviceGrid(geometry.thicknessPt)).toBeCloseTo(0.48, 10);
    expect(quantizeWordPdfDeviceGrid(geometry.offsetTopPt)).toBeCloseTo(0.72, 10);
    expect(geometry.thicknessPt).not.toBeCloseTo(11 / 18, 3);
    expect(WORD_PDF_DEVICE_GRID_PT).toBeCloseTo(0.24, 10);
  });

  test('scales thickness and offset across sizes for Garamond and Aptos', () => {
    const sizes = [8, 10, 11, 12, 14, 18, 24];
    for (const size of sizes) {
      const garamond = pdfSingleUnderlineGeometry(size, GARAMOND_METRICS);
      const aptos = pdfSingleUnderlineGeometry(size, APTOS_METRICS);
      expect(garamond.thicknessPt).toBeCloseTo(size * (102 / 2048), 10);
      expect(garamond.offsetTopPt).toBeCloseTo(size * (154 / 2048), 10);
      expect(aptos.thicknessPt).toBeCloseTo(size * (50 / 2048), 10);
      expect(aptos.offsetTopPt).toBeCloseTo(size * (100 / 2048), 10);
      expect(garamond.thicknessPt).toBeGreaterThan(aptos.thicknessPt);
    }
  });

  test('uses Adobe standard-14 AFM metrics when no face is supplied', () => {
    const geometry = pdfSingleUnderlineGeometry(11);
    expect(PDF_STANDARD_UNDERLINE_METRICS).toEqual({
      unitsPerEm: 1000,
      underlinePosition: -100,
      underlineThickness: 50,
    });
    expect(geometry.thicknessPt).toBeCloseTo(0.55, 10);
    expect(geometry.offsetTopPt).toBeCloseTo(1.1, 10);
  });
});

describe('pdfUnderlineMetricsFromSfnt', () => {
  test('reads Carlito Regular post metrics', () => {
    const metrics = pdfUnderlineMetricsFromSfnt(carlitoBytes, 0);
    expect(metrics).toEqual({
      unitsPerEm: 2048,
      underlinePosition: -103,
      underlineThickness: 194,
    });
    const geometry = pdfSingleUnderlineGeometry(11, metrics!);
    expect(geometry.thicknessPt).toBeCloseTo(11 * (194 / 2048), 10);
    expect(geometry.offsetTopPt).toBeCloseTo(11 * (103 / 2048), 10);
  });
});

describe('canMergeSingleUnderlineRuns', () => {
  test('joins adjacent compatible runs and ordinary space spans', () => {
    const word = segment({ x: 72, width: 30 });
    const space = segment({ x: 102, width: 4 });
    const next = segment({ x: 106, width: 24 });
    expect(canMergeSingleUnderlineRuns(word, space)).toBe(true);
    expect(canMergeSingleUnderlineRuns(space, next)).toBe(true);
    const merged = extendSingleUnderlineRun(extendSingleUnderlineRun(word, space), next);
    expect(merged.x).toBe(72);
    expect(merged.width).toBe(58);
  });

  test('refuses incompatible colour, style, page, or a wide gap', () => {
    const left = segment();
    expect(canMergeSingleUnderlineRuns(left, segment({ color: '#FF0000' }))).toBe(false);
    expect(canMergeSingleUnderlineRuns(left, segment({ thicknessPt: 0.72 }))).toBe(false);
    expect(canMergeSingleUnderlineRuns(left, segment({ offsetTopPt: 0.72 }))).toBe(false);
    expect(canMergeSingleUnderlineRuns(left, segment({ baseline: 700 }))).toBe(false);
    expect(canMergeSingleUnderlineRuns(left, segment({ pageIndex: 1 }))).toBe(false);
    expect(canMergeSingleUnderlineRuns(left, segment({ x: 200, width: 20 }))).toBe(false);
  });

  test('refuses a merge across different link identities', () => {
    const body = segment({ linkKey: null });
    const link = segment({ x: 112, linkKey: 'external:https://example.com' });
    expect(canMergeSingleUnderlineRuns(body, link)).toBe(false);
    expect(canMergeSingleUnderlineRuns(link, segment({ x: 152, linkKey: 'internal:Dest' }))).toBe(
      false
    );
  });
});

describe('pdfUnderlineLinkKey', () => {
  test('names external and internal link commands', () => {
    expect(
      pdfUnderlineLinkKey(pdfExternalLink({ x: 0, y: 0, width: 10, height: 10 }, 'https://a'))
    ).toBe('external:https://a');
    expect(
      pdfUnderlineLinkKey(pdfInternalLink({ x: 0, y: 0, width: 10, height: 10 }, 'Here'))
    ).toBe('internal:Here');
    expect(pdfUnderlineLinkKey(pdfBeginPage(0, 612, 792))).toBeNull();
  });
});

describe('PDFKit single underline fills', () => {
  test('paints 11pt Helvetica geometry as one filled path', async () => {
    const geometry = pdfSingleUnderlineGeometry(11);
    const baseline = 708;
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 700, width: 40, height: 12 },
          baseline,
          'U',
          style({ fontSizePt: 11, decoration: 'underline' })
        ),
      ])
    );
    const fills = fillRects(pdfContentStreams(result.bytes));
    expect(fills).toHaveLength(1);
    const fill = fills[0]!;
    const expected = pdfUnderlineFillRect(
      segment({
        x: 72,
        width: 40,
        baseline,
        thicknessPt: geometry.thicknessPt,
        offsetTopPt: geometry.offsetTopPt,
      })
    );
    expect(fill.x).toBeCloseTo(expected.x, 5);
    expect(fill.width).toBeCloseTo(expected.width, 5);
    expect(fill.height).toBeCloseTo(expected.height, 5);
    expect(fill.height).toBeCloseTo(0.55, 5);
    const pdfKitY = 792 - expected.y - expected.height;
    expect(fill.y).toBeCloseTo(pdfKitY, 5);
  });

  test('covers an ordinary underlined space as one continuous fill', async () => {
    const underlined = style({ fontSizePt: 11, decoration: 'underline' });
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 700, width: 24, height: 12 }, 708, 'ab', underlined),
        pdfTextSpan({ x: 96, y: 700, width: 6, height: 12 }, 708, ' ', underlined),
        pdfTextSpan({ x: 102, y: 700, width: 24, height: 12 }, 708, 'cd', underlined),
      ])
    );
    const fills = fillRects(pdfContentStreams(result.bytes));
    expect(fills).toHaveLength(1);
    expect(fills[0]!.x).toBeCloseTo(72, 5);
    expect(fills[0]!.width).toBeCloseTo(54, 5);
  });

  test('merges adjacent compatible runs and keeps incompatible colours separate', async () => {
    const black = style({ fontSizePt: 11, decoration: 'underline' });
    const red = style({ fontSizePt: 11, decoration: 'underline', color: '#FF0000' });
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 700, width: 20, height: 12 }, 708, 'aa', black),
        pdfTextSpan({ x: 92, y: 700, width: 20, height: 12 }, 708, 'bb', black),
        pdfTextSpan({ x: 72, y: 660, width: 20, height: 12 }, 668, 'cc', black),
        pdfTextSpan({ x: 92, y: 660, width: 20, height: 12 }, 668, 'dd', red),
      ])
    );
    const fills = fillRects(pdfContentStreams(result.bytes));
    expect(fills).toHaveLength(3);
    expect(fills[0]!.width).toBeCloseTo(40, 5);
    expect(fills[1]!.width).toBeCloseTo(20, 5);
    expect(fills[2]!.width).toBeCloseTo(20, 5);
  });

  test('keeps incompatible font sizes as separate fills', async () => {
    const eleven = style({ fontSizePt: 11, decoration: 'underline' });
    const fourteen = style({ fontSizePt: 14, decoration: 'underline' });
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 700, width: 20, height: 12 }, 708, 'aa', eleven),
        pdfTextSpan({ x: 92, y: 700, width: 20, height: 14 }, 708, 'bb', fourteen),
      ])
    );
    const fills = fillRects(pdfContentStreams(result.bytes));
    expect(fills).toHaveLength(2);
    expect(fills[0]!.height).toBeCloseTo(pdfSingleUnderlineGeometry(11).thicknessPt, 5);
    expect(fills[1]!.height).toBeCloseTo(pdfSingleUnderlineGeometry(14).thicknessPt, 5);
  });

  test('does not merge an underlined run into a following hyperlink run', async () => {
    const underlined = style({ fontSizePt: 11, decoration: 'underline', color: '#0563C1' });
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 700, width: 20, height: 12 }, 708, 'ab', underlined),
        pdfTextSpan({ x: 92, y: 700, width: 40, height: 12 }, 708, 'link', underlined),
        pdfExternalLink({ x: 92, y: 700, width: 40, height: 12 }, 'https://example.com'),
      ])
    );
    const fills = fillRects(pdfContentStreams(result.bytes));
    expect(fills).toHaveLength(2);
    expect(fills[0]!.width).toBeCloseTo(20, 5);
    expect(fills[1]!.width).toBeCloseTo(40, 5);
  });

  test('uses Carlito face metrics at 11pt and writes deterministic bytes', async () => {
    const metrics = pdfUnderlineMetricsFromSfnt(carlitoBytes, 0)!;
    const geometry = pdfSingleUnderlineGeometry(11, metrics);
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfTextSpan(
        { x: 72, y: 700, width: 40, height: 12 },
        708,
        'U',
        style({ fontFamily: 'Carlito', fontSizePt: 11, decoration: 'underline' })
      ),
    ]);
    const first = await writePdfPaintPlanToBytes(plan, { admittedFonts: [carlitoFont] });
    const second = await writePdfPaintPlanToBytes(plan, { admittedFonts: [carlitoFont] });
    expect(first.bytes).toEqual(second.bytes);
    const fills = fillRects(pdfContentStreams(first.bytes));
    expect(fills).toHaveLength(1);
    expect(fills[0]!.height).toBeCloseTo(geometry.thicknessPt, 4);
    expect(fills[0]!.height).toBeGreaterThan(0.9);
  });
});
