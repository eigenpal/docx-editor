// Canvas-backed text measurement: selection, security, and centered geometry.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  DEFAULT_RUN_STYLE,
  createFixedMeasurer,
  isCanvasMeasurementAvailable,
  layoutSemanticDocument,
  linesOf,
  resolveDefaultSurfaceMeasurer,
  tryCreateCanvasMeasurer,
  type PageGeometry,
  type ResolvedRunStyle,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/**
 * A controllable 2d context: advance is derived from the px size embedded in `font`, not
 * from host font files — so assertions stay host-independent.
 *
 * Multiplier 0.7 is deliberately wider than the fixed measurer's 6pt*(size/11) grid at
 * typical sizes (the production bug: fixed underestimates real proportional faces ~20%).
 */
function mockContext(fonts: string[] = []): CanvasRenderingContext2D {
  let currentFont = '';
  return {
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
      fonts.push(value);
    },
    measureText(text: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      const sizePx = match ? Number(match[1]) : 11;
      return {
        width: text.length * sizePx * 0.7,
        fontBoundingBoxAscent: sizePx * 0.8,
        fontBoundingBoxDescent: sizePx * 0.2,
      };
    },
  } as CanvasRenderingContext2D;
}

const style = (overrides: Partial<ResolvedRunStyle> = {}): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  ...overrides,
});

describe('tryCreateCanvasMeasurer', () => {
  test('returns null when no 2d context is available', () => {
    expect(tryCreateCanvasMeasurer({ context: null })).toBeNull();
    expect(tryCreateCanvasMeasurer({ ownerDocument: null })).toBeNull();
  });

  test('measures at the painted size and converts back to layout points', () => {
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(), scale: 2 });
    expect(measurer).not.toBeNull();
    // 11pt * scale 2 = 22px; mock advance = len * 22 * 0.7; / scale → len * 11 * 0.7
    expect(measurer!.measure('abcd', style({ fontSizePt: 11 }))).toBeCloseTo(4 * 11 * 0.7, 5);
  });

  test('bold, italic, and point size enter the canvas font shorthand like paint', () => {
    const fonts: string[] = [];
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(fonts), scale: 1 })!;
    measurer.measure('X', style({ fontFamily: 'Arial', fontSizePt: 26, bold: true, italic: true }));
    expect(fonts.at(-1)).toBe(
      'italic bold 26px "Arial", Calibri, Carlito, Helvetica, Arial, sans-serif'
    );
  });

  test('refuses attacker-controlled family strings instead of interpolating them', () => {
    const fonts: string[] = [];
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(fonts), scale: 1 })!;
    measurer.measure(
      'X',
      style({ fontFamily: 'Arial"; } body { background: url(evil)', fontSizePt: 12 })
    );
    const font = fonts.at(-1)!;
    expect(font).not.toContain('evil');
    expect(font).not.toContain('url(');
    expect(font.startsWith('normal normal 12px Calibri')).toBe(true);
  });

  test('super/subscript shrink measurement the same way paint shrinks glyphs', () => {
    const fonts: string[] = [];
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(fonts), scale: 1 })!;
    measurer.measure('X', style({ fontSizePt: 20, verticalAlign: 'superscript' }));
    expect(fonts.at(-1)).toContain('15px');
  });
});

describe('resolveDefaultSurfaceMeasurer', () => {
  test('selects the canvas measurer when a 2d context is supplied', () => {
    const resolved = resolveDefaultSurfaceMeasurer(1, { context: mockContext() });
    expect(resolved.producer).toBe('canvas-measurer');
    // Distinct from the fixed 6pt-wide grid: three characters at 11pt → 23.1, not 18.
    expect(resolved.measurer.measure('abc', style())).toBeCloseTo(3 * 11 * 0.7, 5);
    expect(createFixedMeasurer().measure('abc', style())).toBe(18);
  });

  test('falls back to the fixed measurer when canvas is unavailable', () => {
    const resolved = resolveDefaultSurfaceMeasurer(1, { context: null });
    expect(resolved.producer).toBe('fixed-measurer');
    expect(resolved.measurer.measure('abc', style())).toBe(18);
  });

  test('happy-dom (no real canvas) reports canvas measurement unavailable', () => {
    // Mount tests under happy-dom keep the fixed default; this guards that assumption.
    expect(isCanvasMeasurementAvailable()).toBe(false);
  });
});

describe('centered cover title uses measured width, not the fixed grid', () => {
  const geometry: PageGeometry = {
    width: 612,
    height: 792,
    margin: { top: 72, right: 72, bottom: 72, left: 72 },
  };
  const available = geometry.width - geometry.margin.left - geometry.margin.right;
  const title =
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="52"/></w:rPr>` +
    `<w:t>Cover Title</w:t></w:r></w:p>`;

  const usedWidth = (line: { spans: readonly { box: { x: number; width: number } }[] }) => {
    const first = line.spans[0]!;
    const last = line.spans[line.spans.length - 1]!;
    return last.box.x + last.box.width - first.box.x;
  };

  test('centre slack is computed from the canvas-measured advance', () => {
    const fonts: string[] = [];
    const canvas = tryCreateCanvasMeasurer({ context: mockContext(fonts), scale: 1 })!;
    const layout = layoutSemanticDocument(load(title), 1, {
      measurer: canvas,
      geometry,
      producer: 'canvas-measurer',
    });
    const line = linesOf(layout)[0]!;
    const first = line.spans[0]!;
    const last = line.spans[line.spans.length - 1]!;
    // 26pt Arial Bold — mock advance = len * 26 * 0.5; must appear in the font shorthand.
    expect(
      fonts.some(
        (font) => font.includes('bold') && font.includes('26px') && font.includes('"Arial"')
      )
    ).toBe(true);
    // Layout splits on words; the line's used width is what centering reads.
    const measured =
      canvas.measure('Cover ', first.style) + canvas.measure('Title', last.style);
    expect(usedWidth(line)).toBeCloseTo(measured, 5);
    expect(first.box.x).toBeCloseTo((available - measured) / 2, 5);
    expect(available - (last.box.x + last.box.width)).toBeCloseTo(first.box.x, 5);
  });

  test('the fixed fallback underestimates and shifts the same title right', () => {
    const canvas = tryCreateCanvasMeasurer({ context: mockContext(), scale: 1 })!;
    const fixed = createFixedMeasurer(6, 14);
    const canvasLine = linesOf(
      layoutSemanticDocument(load(title), 1, { measurer: canvas, geometry })
    )[0]!;
    const fixedLine = linesOf(
      layoutSemanticDocument(load(title), 1, { measurer: fixed, geometry })
    )[0]!;
    // Fixed: 6*(26/11)*11 ≈ 156. Mock canvas: 0.7*26*11 = 200.2 — wider, like real Arial Bold.
    expect(usedWidth(fixedLine)).toBeLessThan(usedWidth(canvasLine));
    // Underestimated width → larger centre slack → origin shifts right of the true centre.
    expect(fixedLine.spans[0]!.box.x).toBeGreaterThan(canvasLine.spans[0]!.box.x);
  });
});
