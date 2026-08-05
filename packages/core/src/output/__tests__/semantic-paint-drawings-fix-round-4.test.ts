// Task 10 fix round 4 — crop viewport inside transform stage; affine excludes srcRect.

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

/** Img layout inside crop viewport from srcRect percentage math. */
function imgLayoutInCropViewport(
  contentWidth: number,
  contentHeight: number,
  crop: SourceCrop
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const left = Math.max(0, Math.min(1, crop.left));
  const top = Math.max(0, Math.min(1, crop.top));
  const right = Math.max(0, Math.min(1, crop.right));
  const bottom = Math.max(0, Math.min(1, crop.bottom));
  const visibleW = Math.max(0.000_001, 1 - left - right);
  const visibleH = Math.max(0.000_001, 1 - top - bottom);
  return Object.freeze({
    width: contentWidth / visibleW,
    height: contentHeight / visibleH,
    left: (-left / visibleW) * contentWidth,
    top: (-top / visibleH) * contentHeight,
  });
}

/** Crop viewport clip → transform-stage affine → wp:extent bounds. */
function composedPaintBounds(options: {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly crop: SourceCrop;
  readonly transform: DrawingTransform;
}): ReturnType<typeof boundsOfPoints> {
  const { contentWidth, contentHeight, crop, transform } = options;
  const img = imgLayoutInCropViewport(contentWidth, contentHeight, crop);
  const imgCorners = [
    Object.freeze({ x: img.left, y: img.top }),
    Object.freeze({ x: img.left + img.width, y: img.top }),
    Object.freeze({ x: img.left + img.width, y: img.top + img.height }),
    Object.freeze({ x: img.left, y: img.top + img.height }),
  ];
  const clipped = clipPolygonToBox(imgCorners, {
    x: 0,
    y: 0,
    width: contentWidth,
    height: contentHeight,
  });
  const affine =
    computeCssImageAffine({
      transform,
      contentWidth,
      contentHeight,
    }) ?? Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  const mapped = clipped.map((point) => applyCssImageAffine(point, affine));
  return boundsOfPoints(mapped);
}

function assertExtentFidelity(
  contentWidth: number,
  contentHeight: number,
  crop: SourceCrop,
  xf: DrawingTransform
): void {
  const bbox = composedPaintBounds({
    contentWidth,
    contentHeight,
    crop,
    transform: xf,
  });
  expect(bbox.x).toBeCloseTo(0, 0);
  expect(bbox.y).toBeCloseTo(0, 0);
  expect(bbox.width).toBeCloseTo(contentWidth, 0);
  expect(bbox.height).toBeCloseTo(contentHeight, 0);
}

describe('fix round 4 — crop inside transform stage bounds', () => {
  test('no crop: viewport corners map to wp:extent', () => {
    const contentWidth = 80;
    const contentHeight = 40;
    const xf = transform({
      rotationDegrees: 0,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    assertExtentFidelity(contentWidth, contentHeight, { left: 0, top: 0, right: 0, bottom: 0 }, xf);
  });

  test('25% L/R crop + flipH fills [0,100]×extent height', () => {
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
    const img = imgLayoutInCropViewport(contentWidth, contentHeight, crop);
    expect(img.width).toBeCloseTo(200, 0);
    expect(img.left).toBeCloseTo(-50, 0);
    assertExtentFidelity(contentWidth, contentHeight, crop, xf);
  });

  test('asymmetric crop + 90° fills authoritative extent', () => {
    const contentWidth = 72;
    const contentHeight = 36;
    const crop: SourceCrop = { left: 0.1, top: 0.2, right: 0.05, bottom: 0.15 };
    const xf = transform({
      rotationDegrees: 90,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    assertExtentFidelity(contentWidth, contentHeight, crop, xf);
  });

  test('crop + 45° fills authoritative extent', () => {
    const contentWidth = 40;
    const contentHeight = 20;
    const crop: SourceCrop = { left: 0.15, top: 0.1, right: 0.2, bottom: 0.05 };
    const xf = transform({
      rotationDegrees: 45,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    assertExtentFidelity(contentWidth, contentHeight, crop, xf);
  });

  test('clip polygon stays in outer paint space with crop+transform', () => {
    const contentWidth = 100;
    const contentHeight = 50;
    const crop: SourceCrop = { left: 0.25, top: 0, right: 0.25, bottom: 0 };
    const xf = transform({
      rotationDegrees: 45,
      flipHorizontal: true,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    const geometry = computeDrawingGeometry({
      extentWidth: contentWidth,
      extentHeight: contentHeight,
      anchorX: 10,
      anchorY: 20,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop,
      transform: xf,
      presetGeometry: 'rect',
    });
    const clipXs = geometry.clipPolygon!.map((p) => p.x);
    const clipYs = geometry.clipPolygon!.map((p) => p.y);
    expect(Math.min(...clipXs)).toBeGreaterThanOrEqual(geometry.paintBounds.x - TOL);
    expect(Math.max(...clipXs)).toBeLessThanOrEqual(
      geometry.paintBounds.x + geometry.paintBounds.width + TOL
    );
    expect(Math.min(...clipYs)).toBeGreaterThanOrEqual(geometry.paintBounds.y - TOL);
    expect(Math.max(...clipYs)).toBeLessThanOrEqual(
      geometry.paintBounds.y + geometry.paintBounds.height + TOL
    );
    expect(geometry.contentBounds.width).toBeCloseTo(contentWidth, 0);
    expect(geometry.contentBounds.height).toBeCloseTo(contentHeight, 0);
  });
});

describe('fix round 4 — paint DOM stage order', () => {
  function inlinePictureXml(
    options: {
      readonly rot?: string;
      readonly flipH?: boolean;
      readonly crop?: string;
    } = {}
  ): string {
    const rot = options.rot ? ` rot="${options.rot}"` : '';
    const flipH = options.flipH ? ' flipH="1"' : '';
    const srcRect = options.crop ? `<a:srcRect ${options.crop}/>` : '';
    return (
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="5184000" cy="2592000"/>' +
      '<wp:docPr id="1" name="Picture 1"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}">` +
      '<pic:pic>' +
      `<pic:blipFill><a:blip r:embed="rId1"/>${srcRect}<a:stretch/></pic:blipFill>` +
      `<pic:spPr><a:xfrm${rot}${flipH}><a:off x="0" y="0"/><a:ext cx="5184000" cy="2592000"/></a:xfrm>` +
      '<a:prstGeom prst="rect"/></pic:spPr>' +
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

  test('transform on stage, crop viewport clips img, affine excludes crop', () => {
    const projection = projectDrawing(
      drawingOf(
        load(
          inlinePictureXml({
            rot: '5400000',
            flipH: true,
            crop: 'l="25000" r="25000"',
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
    const frame = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    const stage = element.querySelector('.docx-drawing-transform-stage') as HTMLElement;
    const cropViewport = element.querySelector('.docx-drawing-crop-viewport') as HTMLElement;
    const img = element.querySelector('img') as HTMLImageElement;

    expect(stage).not.toBeNull();
    expect(cropViewport).not.toBeNull();
    expect(stage.style.transform).toMatch(/^matrix\(/);
    expect(stage.style.transformOrigin).toBe('0 0');
    expect(cropViewport.style.overflow).toBe('hidden');
    expect(img.style.transform).toBe('');
    expect(img.style.width).toMatch(/%/);
    expect(frame.style.overflow).not.toBe('hidden');

    const content = drawing.geometry.contentBounds;
    expect(
      cssTransformForDrawingImage({
        transform: drawing.transform,
        contentWidth: content.width,
        contentHeight: content.height,
      })
    ).toBe(stage.style.transform);
    expect(
      computeCssImageAffine({
        transform: drawing.transform,
        contentWidth: content.width,
        contentHeight: content.height,
      })
    ).not.toBeNull();
  });
});
