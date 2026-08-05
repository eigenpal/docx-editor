// Task 8 fix round 2 — authoritative xfrm pipeline, preset clip hits, effect placement, finite guards.

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  computeDrawingGeometry,
  clipPolygonToBox,
  pointInDrawingClip,
  projectPointsThroughXfrm,
  type DrawingGeometryInput,
} from '../drawing-geometry.ts';
import {
  clipInlineDrawingRecordToRegion,
  EMU_PER_POINT,
  measureInlineDrawing,
} from '../drawing-layout.ts';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/index.ts';
import { projectDrawingsInPart } from '../../store/package/drawing-projection.ts';

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
    extentWidth: 72,
    extentHeight: 48,
    anchorX: 10,
    anchorY: 20,
    effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform: identityTransform(),
    presetGeometry: 'rect',
    ...overrides,
  };
}

describe('fix round 2 — xfrm pipeline (off/ext, bbox map, no double scale)', () => {
  test('non-zero offset shifts projected corners before bbox mapping into wp:extent', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 40,
        extentHeight: 40,
        anchorX: 0,
        anchorY: 0,
        transform: Object.freeze({
          rotationDegrees: 0,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 10 * EMU_PER_POINT, y: 5 * EMU_PER_POINT }),
          extentEmu: Object.freeze({ cx: 20 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
        }),
      })
    );
    const xs = geometry.transformedCorners.map((p) => p.x);
    const ys = geometry.transformedCorners.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 2);
    expect(Math.max(...xs)).toBeCloseTo(40, 2);
    expect(Math.min(...ys)).toBeCloseTo(0, 2);
    expect(Math.max(...ys)).toBeCloseTo(40, 2);
    expect(geometry.contentBounds).toEqual({ x: 0, y: 0, width: 40, height: 40 });
  });

  test('xfrm ext differs from wp:extent — bbox maps exactly into outer bounds', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 80,
        extentHeight: 30,
        anchorX: 5,
        anchorY: 5,
        transform: Object.freeze({
          rotationDegrees: 0,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 40 * EMU_PER_POINT, cy: 10 * EMU_PER_POINT }),
        }),
      })
    );
    const xs = geometry.transformedCorners.map((p) => p.x);
    const ys = geometry.transformedCorners.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(5, 2);
    expect(Math.max(...xs)).toBeCloseTo(85, 2);
    expect(Math.min(...ys)).toBeCloseTo(5, 2);
    expect(Math.max(...ys)).toBeCloseTo(35, 2);
  });

  test('90° on non-square source rotates around off+ext/2 then maps bbox to wp:extent', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 40,
        extentHeight: 20,
        anchorX: 0,
        anchorY: 0,
        transform: Object.freeze({
          rotationDegrees: 90,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 40 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
        }),
      })
    );
    const xs = geometry.transformedCorners.map((p) => p.x);
    const ys = geometry.transformedCorners.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 1);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
  });

  test('45° rotation maps transformed bbox corners into wp:extent', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 60,
        extentHeight: 30,
        anchorX: 100,
        anchorY: 50,
        transform: Object.freeze({
          rotationDegrees: 45,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 60 * EMU_PER_POINT, cy: 30 * EMU_PER_POINT }),
        }),
      })
    );
    const xs = geometry.transformedCorners.map((p) => p.x);
    const ys = geometry.transformedCorners.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(100, 0);
    expect(Math.max(...xs)).toBeCloseTo(160, 0);
    expect(Math.min(...ys)).toBeCloseTo(50, 0);
    expect(Math.max(...ys)).toBeCloseTo(80, 0);
  });

  test('flip horizontal with crop maps visible region into wp:extent', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 50,
        extentHeight: 50,
        anchorX: 0,
        anchorY: 0,
        crop: { left: 0.25, top: 0, right: 0.25, bottom: 0 },
        transform: Object.freeze({
          rotationDegrees: 0,
          flipHorizontal: true,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 50 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
        }),
      })
    );
    const xs = geometry.transformedCorners.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(50, 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(50, 1);
  });

  test('projectPointsThroughXfrm maps full polygon into outer 0..layout bounds', () => {
    const unitSquare = Object.freeze([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ]);
    const projected = projectPointsThroughXfrm({
      points: unitSquare,
      sourceWidth: 20,
      sourceHeight: 10,
      offsetX: 5,
      offsetY: 3,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform({ cx: 20 * EMU_PER_POINT, cy: 10 * EMU_PER_POINT }),
      layoutWidth: 40,
      layoutHeight: 20,
      anchorX: 7,
      anchorY: 9,
    });
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(7, 2);
    expect(Math.max(...xs)).toBeCloseTo(47, 2);
    expect(Math.min(...ys)).toBeCloseTo(9, 2);
    expect(Math.max(...ys)).toBeCloseTo(29, 2);
  });
});

describe('fix round 2 — preset clip paint/hit geometry', () => {
  test('ellipse preset clip corners are not hittable outside the clip polygon', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 100,
        extentHeight: 50,
        anchorX: 0,
        anchorY: 0,
        presetGeometry: 'ellipse',
        transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
      })
    );
    expect(geometry.clipPolygon).not.toBeNull();
    expect(pointInDrawingClip(0, 0, geometry)).toBe(false);
    expect(pointInDrawingClip(50, 25, geometry)).toBe(true);
    expect(pointInDrawingClip(100, 0, geometry)).toBe(false);
  });

  test('unsupported custom preset uses rectangular fallback with diagnostic', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        presetGeometry: 'flowChartMagneticDisk',
      })
    );
    expect(geometry.clipFallback).toBe('unsupported-preset');
    expect(geometry.clipPolygon).not.toBeNull();
    const xs = geometry.clipPolygon!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(10, 2);
    expect(Math.max(...xs)).toBeCloseTo(82, 2);
  });

  test('paint and hit outer bounds include signed effect extent on clip bounds', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 100,
        extentHeight: 50,
        anchorX: 0,
        anchorY: 0,
        effectExtentEmu: { top: -12700, right: 25400, bottom: 38100, left: -25400 },
        presetGeometry: 'rect',
      })
    );
    expect(geometry.paintBounds).toEqual({ x: 2, y: 1, width: 100, height: 52 });
    expect(geometry.hitBounds).toEqual(geometry.paintBounds);
  });
});

describe('fix round 2 — inline reservation and effect-expanded clipping', () => {
  test('inline measure reserves extent after distL plus left effect', () => {
    const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const xml = `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:drawing><wp:inline distL="12700" distR="0" distT="0" distB="0"><wp:extent cx="914400" cy="457200"/><wp:effectExtent l="25400" t="0" r="0" b="0"/><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
    const parsed = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    const projections = projectDrawingsInPart(parsed.part);
    expect(projections.length).toBe(1);
    const projection = projections[0]!;
    const measure = measureInlineDrawing(projection);
    expect(measure.totalWidth).toBeCloseTo(measure.distL + 2 + measure.width + measure.distR, 3);
    expect(measure.lineContribution).toBeCloseTo(
      measure.distT + measure.effectT + measure.height + measure.effectB + measure.distB,
      3
    );
  });

  test('clipInlineDrawingRecordToRegion preserves effect-expanded paint before clip', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 100,
        extentHeight: 80,
        anchorX: 0,
        anchorY: 0,
        effectExtentEmu: { top: 12700, right: 12700, bottom: 12700, left: 12700 },
      })
    );
    const clipped = clipInlineDrawingRecordToRegion(
      {
        kind: 'inlineDrawing',
        drawingNodeId: 'd1',
        paragraphId: 'p1',
        ownerPartName: '/word/document.xml',
        start: 0,
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        distL: 0,
        distR: 0,
        distT: 0,
        distB: 0,
        advanceStart: 0,
        advanceEnd: 100,
        baselineOffset: 12,
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
      },
      { x: 10, y: 10, width: 50, height: 40 }
    );
    expect(clipped.geometry.effectInsets.top).toBeCloseTo(1, 3);
    expect(clipped.paintBounds.x).toBeGreaterThanOrEqual(9);
    expect(clipped.paintBounds.width).toBeLessThanOrEqual(51);
  });
});

describe('fix round 2 — polygon clip finite guards', () => {
  test('clipPolygonToBox returns finite bounded output for adversarial input', () => {
    const subject = Object.freeze([
      { x: Number.NaN, y: 0 },
      { x: 100, y: Number.POSITIVE_INFINITY },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const clipped = clipPolygonToBox(subject, { x: 0, y: 0, width: 50, height: 50 });
    for (const point of clipped) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    expect(clipped.length).toBeLessThanOrEqual(256);
  });
});
