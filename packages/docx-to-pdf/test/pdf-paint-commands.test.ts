import { describe, expect, test } from 'bun:test';
import {
  coreBoxToPdfRect,
  corePointToPdfPoint,
  coreYToPdfY,
  createPdfPageTransform,
} from '../src/pdf-coordinates.ts';
import {
  HARD_MAX_PAINT_COMMANDS,
  HARD_MAX_PDF_PAGES,
  PdfPaintValidationError,
} from '../src/pdf-paint-bounds.ts';
import {
  appendPaintCommands,
  createPdfPaintPlan,
  pdfBeginPage,
  pdfClipRect,
  pdfDestination,
  pdfFillRect,
  pdfImage,
  pdfInternalLink,
  pdfRestoreState,
  pdfSaveState,
  pdfTextSpan,
  type PdfPaintCommand,
} from '../src/pdf-paint-types.ts';
import { serializePdfPaintPlan } from '../src/pdf-paint-serialize.ts';
import { pdfTextStyleFromResolvedRunStyle } from '../src/pdf-text-style.ts';

const plainStyle = pdfTextStyleFromResolvedRunStyle({
  fontFamily: 'Helvetica',
  fontFamilyEastAsia: null,
  fontSizePt: 12,
  color: '000000',
  bold: false,
  italic: false,
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
});

describe('Core to PDF coordinate transform', () => {
  test('maps top-left Core Y to bottom-left PDF Y', () => {
    expect(coreYToPdfY(0, 792)).toBe(792);
    expect(coreYToPdfY(72, 792)).toBe(720);
    expect(coreYToPdfY(792, 792)).toBe(0);
  });

  test('converts Core boxes without rounding', () => {
    const rect = coreBoxToPdfRect({ x: 72, y: 96, width: 200.5, height: 48.25 }, 792);
    expect(rect).toEqual({
      x: 72,
      y: 647.75,
      width: 200.5,
      height: 48.25,
    });
  });

  test('converts Core points without rounding', () => {
    expect(corePointToPdfPoint({ x: 10.125, y: 20.375 }, 100)).toEqual({
      x: 10.125,
      y: 79.625,
    });
  });

  test('rejects non-finite coordinates', () => {
    expect(() => coreYToPdfY(Number.NaN, 792)).toThrow(PdfPaintValidationError);
    expect(() => coreBoxToPdfRect({ x: Infinity, y: 0, width: 10, height: 10 }, 792)).toThrow(
      PdfPaintValidationError
    );
  });
});

describe('mixed page sizes', () => {
  test('preserves distinct page dimensions in begin-page commands', () => {
    const letter = createPdfPageTransform(0, 612, 792);
    const a4Landscape = createPdfPageTransform(1, 841.89, 595.28);

    const plan = createPdfPaintPlan([
      pdfBeginPage(letter.pageIndex, letter.pageWidth, letter.pageHeight),
      pdfTextSpan(
        coreBoxToPdfRect({ x: 72, y: 72, width: 100, height: 12 }, letter.pageHeight),
        708,
        'Letter',
        plainStyle
      ),
      pdfBeginPage(a4Landscape.pageIndex, a4Landscape.pageWidth, a4Landscape.pageHeight),
      pdfTextSpan(
        coreBoxToPdfRect({ x: 56.69, y: 56.69, width: 120, height: 12 }, a4Landscape.pageHeight),
        526.59,
        'A4 landscape',
        plainStyle
      ),
    ]);

    expect(plan.commands[0]).toEqual({
      kind: 'beginPage',
      pageIndex: 0,
      width: 612,
      height: 792,
    });
    expect(plan.commands[2]).toEqual({
      kind: 'beginPage',
      pageIndex: 1,
      width: 841.89,
      height: 595.28,
    });
    expect(plan.commands[1]?.kind).toBe('textSpan');
    expect(plan.commands[3]?.kind).toBe('textSpan');
  });
});

describe('clipping and graphics state', () => {
  test('preserves save, clip, paint, restore order with transformed geometry', () => {
    const pageHeight = 792;
    const clipRect = coreBoxToPdfRect({ x: 100, y: 150, width: 300, height: 200 }, pageHeight);

    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, pageHeight),
      pdfSaveState(),
      pdfClipRect(clipRect),
      pdfFillRect(clipRect, '#FF0000'),
      pdfRestoreState(),
      pdfImage(coreBoxToPdfRect({ x: 100, y: 150, width: 300, height: 200 }, pageHeight), 'img-1'),
    ]);

    expect(plan.commands.map((command) => command.kind)).toEqual([
      'beginPage',
      'saveState',
      'clipRect',
      'fillRect',
      'restoreState',
      'image',
    ]);
    expect(plan.commands[2]).toEqual({
      kind: 'clipRect',
      rect: { x: 100, y: 442, width: 300, height: 200 },
    });
    expect(plan.commands[3]).toEqual({
      kind: 'fillRect',
      rect: { x: 100, y: 442, width: 300, height: 200 },
      color: '#FF0000',
    });
  });
});

describe('stacking order', () => {
  test('keeps background, body, and overlay commands in emission order', () => {
    const pageHeight = 792;
    const background = coreBoxToPdfRect({ x: 0, y: 0, width: 612, height: 792 }, pageHeight);
    const body = coreBoxToPdfRect({ x: 72, y: 96, width: 468, height: 600 }, pageHeight);
    const overlay = coreBoxToPdfRect({ x: 400, y: 120, width: 180, height: 90 }, pageHeight);

    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, pageHeight),
      pdfFillRect(background, '#FFFFFF'),
      pdfTextSpan(body, coreYToPdfY(108, pageHeight), 'Body text', plainStyle),
      pdfImage(overlay, 'overlay-1', 0.75),
    ]);

    expect(plan.commands.map((command) => command.kind)).toEqual([
      'beginPage',
      'fillRect',
      'textSpan',
      'image',
    ]);
    expect((plan.commands[3] as ReturnType<typeof pdfImage>).opacity).toBe(0.75);
  });
});

describe('deterministic command serialization', () => {
  test('serializes identical plans to identical strings', () => {
    const pageHeight = 595.28;
    const buildPlan = () =>
      createPdfPaintPlan([
        pdfBeginPage(0, 841.89, pageHeight),
        pdfSaveState(),
        pdfClipRect(
          coreBoxToPdfRect({ x: 10.5, y: 20.25, width: 100.125, height: 50.0625 }, pageHeight)
        ),
        pdfTextSpan(
          coreBoxToPdfRect({ x: 10.5, y: 20.25, width: 100.125, height: 12 }, pageHeight),
          coreYToPdfY(32.25, pageHeight),
          'Deterministic',
          plainStyle
        ),
        pdfRestoreState(),
      ]);

    const first = serializePdfPaintPlan(buildPlan());
    const second = serializePdfPaintPlan(buildPlan());

    expect(first).toBe(second);
    expect(first).toContain('beginPage\t0\t841.89\t595.28');
    expect(first).toContain('clipRect\t10.5,524.9675,100.125,50.0625');
    expect(first).toContain('textSpan\t10.5,563.03,100.125,12\t563.03\tDeterministic');
  });

  test('serializes internal links and named destinations deterministically', () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfDestination('Jump', { x: 72, y: 700, width: 1, height: 12 }),
      pdfInternalLink({ x: 72, y: 600, width: 40, height: 12 }, 'Jump'),
    ]);
    const serialized = serializePdfPaintPlan(plan);
    expect(serialized).toBe(serializePdfPaintPlan(plan));
    expect(serialized).toContain('destination\tJump\t72,700,1,12');
    expect(serialized).toContain('link\t72,600,40,12\tinternal:Jump');
  });

  test('normalizes color tokens to uppercase hex', () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfFillRect({ x: 0, y: 0, width: 10, height: 10 }, '#aabbccdd'),
    ]);
    expect(serializePdfPaintPlan(plan)).toContain('#AABBCCDD');
  });
});

describe('paint plan resource bounds', () => {
  test('refuses a command list longer than HARD_MAX_PAINT_COMMANDS before copying', () => {
    const oversized = { length: HARD_MAX_PAINT_COMMANDS + 1 } as PdfPaintCommand[];
    expect(() => createPdfPaintPlan(oversized)).toThrow(PdfPaintValidationError);
    expect(() => createPdfPaintPlan(oversized)).toThrow(/commandCount/);
  });

  test('refuses a page index at HARD_MAX_PDF_PAGES', () => {
    expect(() => pdfBeginPage(HARD_MAX_PDF_PAGES, 612, 792)).toThrow(PdfPaintValidationError);
    expect(() => pdfBeginPage(HARD_MAX_PDF_PAGES, 612, 792)).toThrow(/pageIndex/);
  });

  test('appends a large command list with bounded iteration instead of varargs', () => {
    const command = pdfBeginPage(0, 612, 792);
    const source: PdfPaintCommand[] = [];
    for (let index = 0; index < 70_000; index += 1) {
      source.push(command);
    }
    const target: PdfPaintCommand[] = [];
    appendPaintCommands(target, source);
    expect(target.length).toBe(70_000);
    expect(target[0]).toBe(command);
    expect(target[69_999]).toBe(command);
  });
});
