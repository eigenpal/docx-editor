// Task 8 fix round 4 — effect-expanded clipped hit region.

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  computeDrawingGeometry,
  pointInDrawingClip,
  type DrawingGeometryInput,
} from '../drawing-geometry.ts';
import { EMU_PER_POINT } from '../drawing-layout.ts';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/index.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawingsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../index.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { linesOf } from '../semantic-records.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';

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
    extentHeight: 50,
    anchorX: 0,
    anchorY: 0,
    effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
    presetGeometry: 'ellipse',
    ...overrides,
  };
}

describe('fix round 4 — effect-expanded clipped hit region', () => {
  test('no-effect ellipse corners miss and center hits', () => {
    const geometry = computeDrawingGeometry(geometryInput());
    expect(pointInDrawingClip(0, 0, geometry)).toBe(false);
    expect(pointInDrawingClip(50, 25, geometry)).toBe(true);
    expect(pointInDrawingClip(100, 0, geometry)).toBe(false);
  });

  test('effect-expanded left band hits outside raw clip but inside paint bounds', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 12700 },
      })
    );
    expect(pointInDrawingClip(-1, 25, geometry)).toBe(true);
    expect(pointInDrawingClip(-2, 25, geometry)).toBe(false);
    expect(pointInDrawingClip(0, 0, geometry)).toBe(false);
  });

  test('effect expansion respects clip boundary not unconditional rectangle', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        presetGeometry: 'rect',
        effectExtentEmu: { top: 12700, right: 12700, bottom: 12700, left: 12700 },
      })
    );
    expect(pointInDrawingClip(-1, -1, geometry)).toBe(true);
    expect(pointInDrawingClip(-3, -3, geometry)).toBe(false);
  });
});

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';
const measurer = createFixedMeasurer(6, 14);

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'c1',
  resourceKey: 'k-ready',
  mime: 'image/png',
  pixelWidth: 10,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});

function inlineEllipseWithEffectInner(): string {
  return (
    '<w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="457200"/>' +
    '<wp:effectExtent l="12700" t="0" r="0" b="0"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="ellipse"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

function anchoredEllipseWithEffectXml(): string {
  return `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>anchor</w:t></w:r><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/><wp:effectExtent l="12700" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="ellipse"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>`;
}

describe('fix round 4 — production semantic hit tests', () => {
  function indexedContext(
    part: import('../../store/index.ts').OoxmlPart
  ): InlineDrawingLayoutContext {
    const atomProjections = indexInlineDrawingProjectionsInPart(part);
    return Object.freeze({
      ownerPartName: OWNER,
      projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
      project: (node) =>
        atomProjections.get(node.id) ??
        projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
      resourceOf: () => READY,
    });
  }

  test('inline ellipse effect band hits left of clip; corner still misses', () => {
    const xml = `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>A</w:t></w:r><w:r>${inlineEllipseWithEffectInner()}</w:r></w:p></w:body></w:document>`;
    const parsed = readOoxmlPart(xml, {
      name: OWNER,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    const layout = layoutSemanticDocument(parsed.part, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(parsed.part),
    });
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const effectBandHit = hitTestPage(layout, 0, {
      x: drawing.x - 1,
      y: line.box.y + drawing.y + drawing.height / 2,
    });
    const cornerHit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x + 1,
      y: line.box.y + drawing.hitBounds.y + 1,
    });
    expect(effectBandHit?.drawing?.drawingNodeId).toBe(drawing.drawingNodeId);
    expect(cornerHit?.drawing).toBeNull();
  });

  test('anchored ellipse effect band hits left of clip via page hit test', () => {
    const parsed = readOoxmlPart(anchoredEllipseWithEffectXml(), {
      name: OWNER,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    const layout = layoutSemanticDocument(parsed.part, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(parsed.part),
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    const centerY = anchor.y + anchor.height / 2;
    const effectHit = hitTestPage(layout, 0, { x: anchor.x - 1, y: centerY });
    const cornerHit = hitTestPage(layout, 0, {
      x: anchor.hitBounds.x + 1,
      y: anchor.hitBounds.y + 1,
    });
    expect(effectHit?.drawing?.drawingNodeId).toBe(anchor.drawingNodeId);
    expect(cornerHit?.drawing).toBeNull();
  });
});
