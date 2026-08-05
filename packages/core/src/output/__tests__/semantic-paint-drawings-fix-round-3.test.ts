// Task 10 fix round 3 — CSS affine derived consistently from source frame through xfrm to wp:extent.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform, SourceCrop } from '../../store/package/drawing-projection.ts';
import {
  applyCssImageAffine,
  boundsOfPoints,
  clipPolygonToBox,
  computeCssImageAffine,
  computeDrawingGeometry,
  cssTransformForDrawingImage,
  type CssImageAffine,
} from '../../layout/drawing-geometry.ts';
import { EMU_PER_POINT } from '../../layout/drawing-layout.ts';
import { DEFAULT_DRAWING_PAINT_STRINGS, paintDrawingRecord } from '../semantic-paint-drawings.ts';
import { buildInlineDrawingRecord, emuToPoints } from '../../layout/drawing-layout.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';

const TOL = 0.5;

function parseMatrix(transform: string): readonly [number, number, number, number, number, number] {
  const match = /matrix\(([^)]+)\)/.exec(transform);
  expect(match).not.toBeNull();
  const parts = match![1]!.split(',').map((part) => Number.parseFloat(part.trim()));
  expect(parts).toHaveLength(6);
  return parts as [number, number, number, number, number, number];
}

function transform(
  t: Partial<DrawingTransform> & Pick<DrawingTransform, 'rotationDegrees'>
): DrawingTransform {
  return Object.freeze({
    rotationDegrees: t.rotationDegrees,
    flipHorizontal: t.flipHorizontal ?? false,
    flipVertical: t.flipVertical ?? false,
    offsetEmu: t.offsetEmu ?? Object.freeze({ x: 0, y: 0 }),
    extentEmu: t.extentEmu ?? Object.freeze({ cx: 0, cy: 0 }),
  });
}

function imgLayoutForCrop(contentWidth: number, contentHeight: number, crop: SourceCrop) {
  const visibleW = Math.max(0.000_001, 1 - crop.left - crop.right);
  const visibleH = Math.max(0.000_001, 1 - crop.top - crop.bottom);
  return Object.freeze({
    width: contentWidth / visibleW,
    height: contentHeight / visibleH,
    left: (-crop.left / visibleW) * contentWidth,
    top: (-crop.top / visibleH) * contentHeight,
  });
}

function clipImgCornersToViewport(
  contentWidth: number,
  contentHeight: number,
  img: ReturnType<typeof imgLayoutForCrop>
) {
  const corners = [
    Object.freeze({ x: img.left, y: img.top }),
    Object.freeze({ x: img.left + img.width, y: img.top }),
    Object.freeze({ x: img.left + img.width, y: img.top + img.height }),
    Object.freeze({ x: img.left, y: img.top + img.height }),
  ];
  return clipPolygonToBox(corners, { x: 0, y: 0, width: contentWidth, height: contentHeight });
}

function imgCorners(
  contentWidth: number,
  contentHeight: number,
  crop: SourceCrop = { left: 0, top: 0, right: 0, bottom: 0 }
) {
  const visibleW = Math.max(0.000_001, 1 - crop.left - crop.right);
  const visibleH = Math.max(0.000_001, 1 - crop.top - crop.bottom);
  const imgW = contentWidth / visibleW;
  const imgH = contentHeight / visibleH;
  return Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: imgW, y: 0 }),
    Object.freeze({ x: imgW, y: imgH }),
    Object.freeze({ x: 0, y: imgH }),
  ]);
}

function assertBboxMatchesExtent(
  affine: CssImageAffine,
  contentWidth: number,
  contentHeight: number,
  crop: SourceCrop = { left: 0, top: 0, right: 0, bottom: 0 }
): void {
  const corners = imgCorners(contentWidth, contentHeight, crop);
  const mapped = corners.map((point) => applyCssImageAffine(point, affine));
  const bbox = boundsOfPoints(mapped);
  expect(bbox.x).toBeCloseTo(0, 0);
  expect(bbox.y).toBeCloseTo(0, 0);
  expect(bbox.width).toBeCloseTo(contentWidth, 0);
  expect(bbox.height).toBeCloseTo(contentHeight, 0);
}

describe('fix round 3 — CSS affine corner/bounds fidelity', () => {
  test('72×36 at 90° maps img corners to 72×36 outer extent', () => {
    const contentWidth = 72;
    const contentHeight = 36;
    const xf = transform({
      rotationDegrees: 90,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    const affine = computeCssImageAffine({ transform: xf, contentWidth, contentHeight });
    expect(affine).not.toBeNull();
    assertBboxMatchesExtent(affine!, contentWidth, contentHeight);
    const matrix = cssTransformForDrawingImage({ transform: xf, contentWidth, contentHeight });
    expect(matrix).toMatch(/^matrix\(/);
    const [a, b, c, d, e, f] = parseMatrix(matrix!);
    expect(affine!.a).toBeCloseTo(a, 4);
    expect(affine!.b).toBeCloseTo(b, 4);
    expect(affine!.c).toBeCloseTo(c, 4);
    expect(affine!.d).toBeCloseTo(d, 4);
    expect(affine!.e).toBeCloseTo(e, 4);
    expect(affine!.f).toBeCloseTo(f, 4);
  });

  test('non-square 45° fills authoritative extent bbox', () => {
    const contentWidth = 40;
    const contentHeight = 20;
    const xf = transform({
      rotationDegrees: 45,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    const affine = computeCssImageAffine({ transform: xf, contentWidth, contentHeight })!;
    assertBboxMatchesExtent(affine, contentWidth, contentHeight);
    const [a, b, c, d] = parseMatrix(
      cssTransformForDrawingImage({ transform: xf, contentWidth, contentHeight })!
    );
    expect(Math.abs(b)).toBeGreaterThan(0.05);
    expect(Math.abs(c)).toBeGreaterThan(0.05);
    expect(Math.abs(a)).toBeGreaterThan(0.05);
    expect(Math.abs(d)).toBeGreaterThan(0.05);
  });

  test('180° rotation maps corners to full extent', () => {
    const contentWidth = 50;
    const contentHeight = 30;
    const xf = transform({
      rotationDegrees: 180,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    const affine = computeCssImageAffine({ transform: xf, contentWidth, contentHeight })!;
    assertBboxMatchesExtent(affine, contentWidth, contentHeight);
  });

  test('flip+crop keeps bbox on outer extent and clip in paint space', () => {
    const contentWidth = 100;
    const contentHeight = 50;
    const crop: SourceCrop = { left: 0.25, top: 0, right: 0.25, bottom: 0 };
    const xf = transform({
      rotationDegrees: 0,
      flipHorizontal: true,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    const img = imgLayoutForCrop(contentWidth, contentHeight, crop);
    const clipped = clipImgCornersToViewport(contentWidth, contentHeight, img);
    const affine = computeCssImageAffine({ transform: xf, contentWidth, contentHeight })!;
    const mapped = clipped.map((point) => applyCssImageAffine(point, affine));
    const bbox = boundsOfPoints(mapped);
    expect(bbox.x).toBeCloseTo(0, 0);
    expect(bbox.y).toBeCloseTo(0, 0);
    expect(bbox.width).toBeCloseTo(contentWidth, 0);
    expect(bbox.height).toBeCloseTo(contentHeight, 0);

    const geometry = computeDrawingGeometry({
      extentWidth: contentWidth,
      extentHeight: contentHeight,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop,
      transform: xf,
      presetGeometry: 'rect',
    });
    const clipXs = geometry.clipPolygon!.map((p) => p.x);
    const clipYs = geometry.clipPolygon!.map((p) => p.y);
    expect(Math.min(...clipXs)).toBeGreaterThanOrEqual(-TOL);
    expect(Math.max(...clipXs)).toBeLessThanOrEqual(contentWidth + TOL);
    expect(Math.min(...clipYs)).toBeGreaterThanOrEqual(-TOL);
    expect(Math.max(...clipYs)).toBeLessThanOrEqual(contentHeight + TOL);
  });

  test('differing a:xfrm ext/off maps corners to wp:extent', () => {
    const contentWidth = 100;
    const contentHeight = 100;
    const xf = transform({
      rotationDegrees: 90,
      offsetEmu: Object.freeze({ x: 10 * EMU_PER_POINT, y: 5 * EMU_PER_POINT }),
      extentEmu: Object.freeze({ cx: 80 * EMU_PER_POINT, cy: 60 * EMU_PER_POINT }),
    });
    const affine = computeCssImageAffine({ transform: xf, contentWidth, contentHeight })!;
    assertBboxMatchesExtent(affine, contentWidth, contentHeight);

    const geometry = computeDrawingGeometry({
      extentWidth: contentWidth,
      extentHeight: contentHeight,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: xf,
      presetGeometry: 'rect',
    });
    const cornerXs = geometry.transformedCorners.map((p) => p.x);
    const cornerYs = geometry.transformedCorners.map((p) => p.y);
    expect(Math.max(...cornerXs) - Math.min(...cornerXs)).toBeCloseTo(contentWidth, 0);
    expect(Math.max(...cornerYs) - Math.min(...cornerYs)).toBeCloseTo(contentHeight, 0);
  });
});

describe('fix round 3 — paint transform-origin and matrix terms', () => {
  function inlinePictureXml(
    options: {
      readonly extent?: string;
      readonly rot?: string;
      readonly flipH?: boolean;
      readonly xfrmExt?: string;
      readonly crop?: string;
    } = {}
  ): string {
    const extent = options.extent ?? 'cx="5184000" cy="2592000"';
    const rot = options.rot ? ` rot="${options.rot}"` : '';
    const flipH = options.flipH ? ' flipH="1"' : '';
    const xfrmExt = options.xfrmExt ?? 'cx="5184000" cy="2592000"';
    const srcRect = options.crop ? `<a:srcRect ${options.crop}/>` : '';
    return (
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing>' +
      `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent ${extent}/>` +
      '<wp:docPr id="1" name="Picture 1"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}">` +
      '<pic:pic>' +
      `<pic:blipFill><a:blip r:embed="rId1"/>${srcRect}<a:stretch/></pic:blipFill>` +
      `<pic:spPr><a:xfrm${rot}${flipH}><a:off x="0" y="0"/><a:ext ${xfrmExt}/></a:xfrm>` +
      `<a:prstGeom prst="rect"/></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
  }

  function load(xml: string): OoxmlPart {
    const result = readOoxmlPart(xml, {
      name: OWNER,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  }

  function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
    const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
    while (stack.length > 0) {
      const node = stack.shift()!;
      if (node.kind === 'drawing') return node;
      for (const child of node.children) {
        if (child.kind !== 'textValue') stack.push(child);
      }
    }
    throw new Error('missing drawing');
  }

  test('paint uses transform-origin 0 0 when matrix includes bbox compensation', () => {
    const projection = projectDrawing(
      drawingOf(
        load(
          inlinePictureXml({
            rot: '5400000',
            extent: 'cx="5184000" cy="2592000"',
            xfrmExt: 'cx="2592000" cy="5184000"',
          })
        )
      ),
      { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }
    )!;
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: projection.drawingNodeId,
        ownerPartName: OWNER,
        projection,
        resource: Object.freeze({
          kind: 'ready',
          partName: null,
          contentId: '',
          resourceKey: '',
          mime: 'image/png',
          pixelWidth: 1,
          pixelHeight: 1,
          dpiX: 96,
          dpiY: 96,
        }),
      },
      paragraphId: 'p1',
      start: 0,
      slotX: 0,
      y: 0,
      baseline: emuToPoints(projection.extentEmu.cy),
      contentLeft: 0,
      contentRight: 600,
    });
    const element = paintDrawingRecord(
      document,
      drawing,
      {
        scale: 1,
        strings: DEFAULT_DRAWING_PAINT_STRINGS,
        imageUrlPort: { create: () => 'blob:t', revoke: () => {} },
      },
      { urlForReady: () => 'blob:t', reconcile: () => {}, revokeAll: () => {} }
    )!;
    const stage = element.querySelector('.docx-drawing-transform-stage') as HTMLElement;
    expect(stage.style.transform).toMatch(/^matrix\(/);
    expect(stage.style.transformOrigin).toBe('0 0');
    expect(element.style.clipPath).toMatch(/^polygon\(/);
  });
});
