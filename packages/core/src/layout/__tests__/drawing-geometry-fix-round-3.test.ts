// Task 8 fix round 3 — shared xfrm affine mapping, baseline effect placement, clip hits.

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  computeDrawingGeometry,
  computeXfrmPageMapping,
  pointInDrawingClip,
  projectPointsThroughXfrm,
  type DrawingGeometryInput,
} from '../drawing-geometry.ts';
import {
  EMU_PER_POINT,
  measureInlineDrawing,
  repositionInlineDrawingsForBaseline,
  type InlineDrawingRecord,
} from '../drawing-layout.ts';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/index.ts';
import { projectDrawingsInPart } from '../../store/package/drawing-projection.ts';
import { inlineDrawingVerticalLayout } from '../drawing-layout.ts';

const identityTransform = (
  extentEmu: { cx: number; cy: number } = { cx: 914400, cy: 457200 }
): DrawingTransform =>
  Object.freeze({
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
    offsetEmu: Object.freeze({ x: 0, y: 0 }),
    extentEmu: Object.freeze(extentEmu),
  });

function geometryInput(overrides: Partial<DrawingGeometryInput> = {}): DrawingGeometryInput {
  return {
    extentWidth: 100,
    extentHeight: 100,
    anchorX: 0,
    anchorY: 0,
    effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 100 * EMU_PER_POINT }),
    presetGeometry: 'rect',
    ...overrides,
  };
}

describe('fix round 3 — shared xfrm affine from full source frame', () => {
  test('25..75 crop subtriangle stays centered at half size with shared matrix', () => {
    const crop = { left: 0.25, top: 0.25, right: 0.25, bottom: 0.25 };
    const triangle = Object.freeze([
      { x: 50, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const fullSquare = Object.freeze([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const opts = {
      sourceWidth: 100,
      sourceHeight: 100,
      offsetX: 0,
      offsetY: 0,
      crop,
      transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 100 * EMU_PER_POINT }),
      layoutWidth: 100,
      layoutHeight: 100,
      anchorX: 0,
      anchorY: 0,
    };
    const mapping = computeXfrmPageMapping(opts);
    const projectedTriangle = projectPointsThroughXfrm({ points: triangle, ...opts });
    const projectedSquare = projectPointsThroughXfrm({
      points: fullSquare,
      ...opts,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    });
    const triXs = projectedTriangle.map((p) => p.x);
    const triYs = projectedTriangle.map((p) => p.y);
    expect(Math.min(...triXs)).toBeCloseTo(25, 1);
    expect(Math.max(...triXs)).toBeCloseTo(75, 1);
    expect(Math.min(...triYs)).toBeCloseTo(25, 1);
    expect(Math.max(...triYs)).toBeCloseTo(75, 1);
    const sqXs = projectedSquare.map((p) => p.x);
    expect(Math.min(...sqXs)).toBeCloseTo(0, 1);
    expect(Math.max(...sqXs)).toBeCloseTo(100, 1);
    expect(mapping.scaleX).toBeCloseTo(1, 3);
    expect(mapping.scaleY).toBeCloseTo(1, 3);
  });

  test('off/ext shift shared matrix maps preset clip from full frame regardless of crop', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        crop: { left: 0.25, top: 0.25, right: 0.25, bottom: 0.25 },
        transform: Object.freeze({
          rotationDegrees: 0,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 10 * EMU_PER_POINT, y: 5 * EMU_PER_POINT }),
          extentEmu: Object.freeze({ cx: 80 * EMU_PER_POINT, cy: 60 * EMU_PER_POINT }),
        }),
        extentWidth: 100,
        extentHeight: 100,
        presetGeometry: 'rect',
      })
    );
    const uncropped = computeDrawingGeometry(
      geometryInput({
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        transform: Object.freeze({
          rotationDegrees: 0,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 10 * EMU_PER_POINT, y: 5 * EMU_PER_POINT }),
          extentEmu: Object.freeze({ cx: 80 * EMU_PER_POINT, cy: 60 * EMU_PER_POINT }),
        }),
        extentWidth: 100,
        extentHeight: 100,
        presetGeometry: 'rect',
      })
    );
    const xs = geometry.clipPolygon!.map((p) => p.x);
    const ys = geometry.clipPolygon!.map((p) => p.y);
    const uncroppedXs = uncropped.clipPolygon!.map((p) => p.x);
    const uncroppedYs = uncropped.clipPolygon!.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(Math.min(...uncroppedXs), 1);
    expect(Math.max(...xs)).toBeCloseTo(Math.max(...uncroppedXs), 1);
    expect(Math.min(...ys)).toBeCloseTo(Math.min(...uncroppedYs), 1);
    expect(Math.max(...ys)).toBeCloseTo(Math.max(...uncroppedYs), 1);
    const cornerXs = geometry.transformedCorners.map((p) => p.x);
    expect(Math.min(...cornerXs)).toBeCloseTo(0, 1);
    expect(Math.max(...cornerXs)).toBeCloseTo(100, 1);
  });
});

describe('fix round 3 — baseline finalization preserves effect extent', () => {
  function sampleDrawing(overrides: Partial<InlineDrawingRecord> = {}): InlineDrawingRecord {
    const geometry = computeDrawingGeometry(
      geometryInput({
        effectExtentEmu: { top: 12700, right: 0, bottom: 25400, left: 0 },
      })
    );
    return Object.freeze({
      kind: 'inlineDrawing',
      drawingNodeId: 'd1',
      paragraphId: 'p1',
      ownerPartName: '/word/document.xml',
      start: 0,
      x: 0,
      y: 10,
      width: 100,
      height: 50,
      distL: 0,
      distR: 0,
      distT: 0,
      distB: 5,
      advanceStart: 0,
      advanceEnd: 100,
      baselineOffset: 60,
      paintBounds: geometry.paintBounds,
      hitBounds: geometry.hitBounds,
      geometry,
      resource: Object.freeze({
        kind: 'ready',
        partName: null,
        contentId: '',
        resourceKey: '',
        mime: '',
        pixelWidth: 1,
        pixelHeight: 1,
        dpiX: 96,
        dpiY: 96,
      }),
      accessibility: Object.freeze({ hidden: false, decorative: true, label: null }),
      ...overrides,
    });
  }

  test('effect-expanded outer bottom aligns final baseline with distB separate', () => {
    const finalBaseline = 80;
    const [repositioned] = repositionInlineDrawingsForBaseline([sampleDrawing()], finalBaseline);
    expect(
      repositioned!.y + repositioned!.height + repositioned!.geometry.effectInsets.bottom
    ).toBeCloseTo(finalBaseline, 3);
    expect(repositioned!.baselineOffset).toBe(finalBaseline);
  });

  test('inlineDrawingVerticalLayout and final reposition agree on effectT/B line height', () => {
    const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const xml = `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:drawing><wp:inline distL="0" distR="0" distT="0" distB="12700"><wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="12700" r="0" b="25400"/><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:t>text</w:t></w:r></w:p></w:body></w:document>`;
    const parsed = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    const projection = projectDrawingsInPart(parsed.part)[0]!;
    const measure = measureInlineDrawing(projection);
    const textBaseline = 12;
    const textLineHeight = 14;
    const layout = inlineDrawingVerticalLayout(textBaseline, textLineHeight, measure);
    const drawing = sampleDrawing({ y: layout.extentTopY, baselineOffset: layout.baseline });
    const [finalized] = repositionInlineDrawingsForBaseline([drawing], layout.baseline);
    expect(finalized!.y + finalized!.height + finalized!.geometry.effectInsets.bottom).toBeCloseTo(
      layout.baseline,
      3
    );
    expect(layout.lineHeight).toBeGreaterThanOrEqual(
      layout.extentTopY - measure.effectT + measure.height + measure.effectB + measure.distB
    );
  });
});

describe('fix round 3 — preset clip in production hit path', () => {
  test('ellipse corners miss and center hits via clip not bbox alone', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        presetGeometry: 'ellipse',
        transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
        extentWidth: 100,
        extentHeight: 50,
      })
    );
    expect(pointInDrawingClip(0, 0, geometry)).toBe(false);
    expect(pointInDrawingClip(50, 25, geometry)).toBe(true);
    expect(pointInDrawingClip(100, 0, geometry)).toBe(false);
  });
});
