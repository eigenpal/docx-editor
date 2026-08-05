// Task 10 fix round 5 — crop img uses absolute left/top (height-relative top), not margin-top.

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

function parsePercent(value: string): number {
  const match = /^(-?\d+(?:\.\d+)?)%$/.exec(value.trim());
  expect(match).not.toBeNull();
  return Number.parseFloat(match![1]!) / 100;
}

/** srcRect crop → percentage styles matching paint output. */
function cropStylesFromFractions(crop: SourceCrop): {
  readonly width: string;
  readonly height: string;
  readonly left: string;
  readonly top: string;
} {
  const left = Math.max(0, Math.min(1, crop.left));
  const top = Math.max(0, Math.min(1, crop.top));
  const right = Math.max(0, Math.min(1, crop.right));
  const bottom = Math.max(0, Math.min(1, crop.bottom));
  const visibleW = Math.max(0.000_1, 1 - left - right);
  const visibleH = Math.max(0.000_1, 1 - top - bottom);
  const pct = (n: number) => `${Math.round(n * 1_000_000) / 1_000_000}%`;
  return Object.freeze({
    width: pct((1 / visibleW) * 100),
    height: pct((1 / visibleH) * 100),
    left: pct((-left / visibleW) * 100),
    top: pct((-top / visibleH) * 100),
  });
}

/** Browser CSS: top/height % → containing-block height; left/width % → width. */
function absoluteImgPixelLayout(
  viewportW: number,
  viewportH: number,
  styles: {
    readonly left: string;
    readonly top: string;
    readonly width: string;
    readonly height: string;
  }
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  return Object.freeze({
    left: parsePercent(styles.left) * viewportW,
    top: parsePercent(styles.top) * viewportH,
    width: parsePercent(styles.width) * viewportW,
    height: parsePercent(styles.height) * viewportH,
  });
}

/** Buggy margin-top: vertical offset uses viewport width, not height. */
function marginTopBuggyPixelLayout(
  viewportW: number,
  viewportH: number,
  styles: {
    readonly left: string;
    readonly top: string;
    readonly width: string;
    readonly height: string;
  }
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  return Object.freeze({
    left: parsePercent(styles.left) * viewportW,
    top: parsePercent(styles.top) * viewportW,
    width: parsePercent(styles.width) * viewportW,
    height: parsePercent(styles.height) * viewportH,
  });
}

function imgCornersFromPixelLayout(layout: {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}) {
  return [
    Object.freeze({ x: layout.left, y: layout.top }),
    Object.freeze({ x: layout.left + layout.width, y: layout.top }),
    Object.freeze({ x: layout.left + layout.width, y: layout.top + layout.height }),
    Object.freeze({ x: layout.left, y: layout.top + layout.height }),
  ];
}

function composedPaintBounds(options: {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly crop: SourceCrop;
  readonly transform: DrawingTransform;
  readonly layoutFromStyles: (
    viewportW: number,
    viewportH: number,
    styles: ReturnType<typeof cropStylesFromFractions>
  ) => {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}): ReturnType<typeof boundsOfPoints> {
  const { contentWidth, contentHeight, crop, transform, layoutFromStyles } = options;
  const styles = cropStylesFromFractions(crop);
  const img = layoutFromStyles(contentWidth, contentHeight, styles);
  const clipped = clipPolygonToBox(imgCornersFromPixelLayout(img), {
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
  return boundsOfPoints(clipped.map((point) => applyCssImageAffine(point, affine)));
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
    layoutFromStyles: absoluteImgPixelLayout,
  });
  expect(bbox.x).toBeCloseTo(0, 0);
  expect(bbox.y).toBeCloseTo(0, 0);
  expect(bbox.width).toBeCloseTo(contentWidth, 0);
  expect(bbox.height).toBeCloseTo(contentHeight, 0);
}

describe('fix round 5 — CSS percentage semantics for crop img', () => {
  test('margin-top vertical offset is width-relative in CSS — wrong on 100×50', () => {
    const contentWidth = 100;
    const contentHeight = 50;
    const crop: SourceCrop = { left: 0.25, top: 0.1, right: 0.25, bottom: 0.1 };
    const styles = cropStylesFromFractions(crop);

    const absolute = absoluteImgPixelLayout(contentWidth, contentHeight, styles);
    const buggy = marginTopBuggyPixelLayout(contentWidth, contentHeight, styles);

    expect(absolute.left).toBeCloseTo(-50, 2);
    expect(buggy.left).toBeCloseTo(-50, 2);
    expect(absolute.top).toBeCloseTo(-6.25, 2);
    expect(buggy.top).toBeCloseTo(-12.5, 2);
    expect(buggy.top).not.toBeCloseTo(absolute.top, 1);
  });

  test('100×50 asymmetric top/bottom crop + 90° fills authoritative extent', () => {
    const contentWidth = 100;
    const contentHeight = 50;
    const crop: SourceCrop = { left: 0, top: 0.2, right: 0, bottom: 0.1 };
    const xf = transform({
      rotationDegrees: 90,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    assertExtentFidelity(contentWidth, contentHeight, crop, xf);
  });

  test('100×50 asymmetric top/bottom crop + flipH + 45° fills authoritative extent', () => {
    const contentWidth = 100;
    const contentHeight = 50;
    const crop: SourceCrop = { left: 0.05, top: 0.2, right: 0.1, bottom: 0.15 };
    const xf = transform({
      rotationDegrees: 45,
      flipHorizontal: true,
      flipVertical: true,
      extentEmu: Object.freeze({
        cx: contentWidth * EMU_PER_POINT,
        cy: contentHeight * EMU_PER_POINT,
      }),
    });
    assertExtentFidelity(contentWidth, contentHeight, crop, xf);
  });

  test('clip polygon stays in outer paint space with corrected crop layout', () => {
    const contentWidth = 100;
    const contentHeight = 50;
    const crop: SourceCrop = { left: 0, top: 0.2, right: 0, bottom: 0.1 };
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
  });
});

describe('fix round 5 — paint DOM absolute crop positioning', () => {
  function inlinePictureXml(
    options: {
      readonly rot?: string;
      readonly flipH?: boolean;
      readonly flipV?: boolean;
      readonly crop?: string;
    } = {}
  ): string {
    const rot = options.rot ? ` rot="${options.rot}"` : '';
    const flipH = options.flipH ? ' flipH="1"' : '';
    const flipV = options.flipV ? ' flipV="1"' : '';
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
      `<pic:spPr><a:xfrm${rot}${flipH}${flipV}><a:off x="0" y="0"/><a:ext cx="5184000" cy="2592000"/></a:xfrm>` +
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

  function paintFromXml(xml: string) {
    const projection = projectDrawing(drawingOf(load(xml)), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
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
    return paintDrawingRecord(
      document,
      drawing,
      {
        scale: 1,
        strings: DEFAULT_DRAWING_PAINT_STRINGS,
        imageUrlPort: { create: () => 'blob:t', revoke: () => {} },
      },
      { urlForReady: () => 'blob:t', reconcile: () => {}, revokeAll: () => {} }
    )!;
  }

  test('crop img is absolutely positioned with left/top percentages, no margins', () => {
    const element = paintFromXml(
      inlinePictureXml({
        rot: '5400000',
        flipH: true,
        crop: 'l="25000" t="10000" r="25000" b="10000"',
      })
    );
    const cropViewport = element.querySelector('.docx-drawing-crop-viewport') as HTMLElement;
    const img = element.querySelector('img') as HTMLImageElement;

    expect(cropViewport.style.position).toBe('relative');
    expect(img.style.position).toBe('absolute');
    expect(img.style.left).toBe('-50%');
    expect(img.style.top).toBe('-12.5%');
    expect(img.style.width).toBe('200%');
    expect(img.style.height).toBe('125%');
    expect(img.style.marginLeft).toBe('');
    expect(img.style.marginTop).toBe('');
    expect(img.style.transform).toBe('');

    const stage = element.querySelector('.docx-drawing-transform-stage') as HTMLElement;
    expect(stage.style.transform).toMatch(/^matrix\(/);
    expect(stage.style.transformOrigin).toBe('0 0');
  });

  test('100×50 asymmetric crop under rotation uses height-relative top', () => {
    const element = paintFromXml(
      inlinePictureXml({
        rot: '2700000',
        flipV: true,
        crop: 'l="0" t="20000" r="0" b="10000"',
      })
    );
    const img = element.querySelector('img') as HTMLImageElement;
    expect(img.style.position).toBe('absolute');
    expect(img.style.top).toMatch(/^-28\.571428/);
    expect(img.style.left).toBe('0%');
    expect(img.style.height).toMatch(/^142\.857142/);
    expect(img.style.marginTop).toBe('');
  });
});
