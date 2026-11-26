// A synthesized stand-in face is measurable, but it is not installed.
//
// A host resolver serves only the regular face of a family. The bold face stands in through
// the regular face with a synthesized bold. Layout measures it with real metrics, so a bold
// end-of-cell mark keeps its line and a list marker in a symbol face keeps that face. The
// probe for an installed face still answers false, so a face that loads later is not
// counted early.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { FontConfiguration, FontSource } from '../../contracts/editor.ts';
import {
  applyDocumentFontSubstitutions,
  documentStandInFaces,
} from '../../layout/document-font-substitution.ts';
import { composeFontConfiguration } from '../../layout/font-composition.ts';
import {
  DEFAULT_RUN_STYLE,
  fontRequestKey,
  resolveDefaultSurfaceMeasurer,
  sha256FontBytes,
  type LayoutShapingOptions,
  type ResolvedRunStyle,
} from '../../layout/index.ts';
import { markerSymbolFontAvailability } from '../../layout/marker-symbol-font.ts';
import { readTableStructure } from '../../layout/semantic-table.ts';
import { cellEndMarkHeight } from '../../layout/table-cell-end-mark.ts';
import { measuresWithAdmittedFace, type TextMeasurer } from '../../layout/text-measurer.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutShaping, disposeLayoutShaping } from '../font-configuration.ts';
import { resolvedFontMeasurement } from '../resolved-font-measurement.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const source = (family: string, weight: number): FontSource => ({
  request: { family, weight, style: 'normal' },
  id: `${family}-${weight}`,
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
});

/** The host serves the regular face of `Brand Light` only, through `Stand In`. */
function partlyServed(): FontConfiguration {
  return applyDocumentFontSubstitutions(
    composeFontConfiguration({
      sources: [source('Stand In', 400)],
      substitutions: [
        {
          from: { family: 'Brand Light', weight: 400, style: 'normal' },
          to: { family: 'Stand In', weight: 400, style: 'normal' },
        },
      ],
    }),
    {
      families: ['Brand Light'],
      alternates: new Map(),
      fallbacks: new Map(),
      ambiguousFamilies: [],
    }
  );
}

const bold: ResolvedRunStyle = { ...DEFAULT_RUN_STYLE, fontFamily: 'Brand Light', bold: true };
let shaping: LayoutShapingOptions;
let measurer: TextMeasurer;
beforeAll(async () => {
  const fonts = partlyServed();
  shaping = await createLayoutShaping(fonts);
  measurer = resolvedFontMeasurement(
    shaping,
    fonts,
    resolveDefaultSurfaceMeasurer(1, { context: null }),
    1,
    1
  ).measurer;
});
afterAll(() => disposeLayoutShaping(shaping));

test('a stand-in bold face is measurable but not installed', () => {
  const fonts = partlyServed();
  expect(
    documentStandInFaces(fonts).has(
      fontRequestKey({ family: 'Brand Light', weight: 700, style: 'normal' })
    )
  ).toBe(true);
  expect(measurer.syntheticBold?.(bold)).toBe(true);
  expect(measurer.hasResolvedFont?.(bold)).toBe(false);
  expect(measurer.hasMeasurableFont?.(bold)).toBe(true);
  expect(measuresWithAdmittedFace(measurer, bold)).toBe(true);
});

test('a bold end-of-cell mark in a partly served family keeps its line', () => {
  const part = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:pPr><w:rPr><w:rFonts w:ascii="Brand Light" w:hAnsi="Brand Light"/><w:b/><w:sz w:val="40"/></w:rPr></w:pPr></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!part.ok) throw new Error(part.reason);
  const body = part.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const table = body.children.find((child) => child.kind === 'table')!;
  const cell = readTableStructure(table, 100, 0)!.rows[0]!.cells[0]!;
  const deps = { producer: 'stand-in-end-mark', nextLineId: () => 'line', measurer };
  const height = cellEndMarkHeight(cell, 100, deps);
  // The 20 pt bold mark measures through the regular face; it no longer drops its line.
  expect(height).toBeGreaterThan(20);
  expect(height).toBeCloseTo(measurer.lineMetrics({ ...bold, fontSizePt: 20 }).height, 5);
});

test('a symbol face that layout can measure keeps a list marker in that face', () => {
  const symbol = (style: ResolvedRunStyle) => style.fontFamily?.toLowerCase() === 'symbol';
  const oracle = markerSymbolFontAvailability({
    measure: () => 0,
    lineMetrics: () => ({ height: 12, baseline: 10 }),
    hasResolvedFont: () => false,
    hasMeasurableFont: symbol,
  });
  expect(oracle?.('symbol')).toBe(true);
  expect(oracle?.('wingdings')).toBe(false);
});
