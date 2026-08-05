// A typed `wps:wsp` solid-geometry shape paints as inline SVG, not a placeholder card.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type { VectorShapeProjection } from '../../store/package/drawing-projection.ts';
import { computeDrawingGeometry } from '../../layout/drawing-geometry.ts';
import { EMU_PER_POINT, type InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import { DEFAULT_DRAWING_PAINT_STRINGS, paintDrawingRecord } from '../semantic-paint-drawings.ts';

const EXTENT = Object.freeze({ cx: 6_696_075, cy: 47_625 });

function vectorShape(): VectorShapeProjection {
  return Object.freeze({
    extentEmu: EXTENT,
    subpathsEmu: Object.freeze([
      Object.freeze([
        Object.freeze({ x: 6_696_075, y: 38_100 }),
        Object.freeze({ x: 0, y: 38_100 }),
        Object.freeze({ x: 0, y: 47_625 }),
        Object.freeze({ x: 6_696_075, y: 47_625 }),
      ]),
      Object.freeze([
        Object.freeze({ x: 6_696_075, y: 0 }),
        Object.freeze({ x: 0, y: 0 }),
        Object.freeze({ x: 0, y: 9_525 }),
        Object.freeze({ x: 6_696_075, y: 9_525 }),
      ]),
    ]),
    fillHex: '000000',
    strokeHex: null,
    strokeWidthEmu: 0,
  });
}

function shapeRecord(): InlineDrawingRecord {
  const width = EXTENT.cx / EMU_PER_POINT;
  const height = EXTENT.cy / EMU_PER_POINT;
  const geometry = computeDrawingGeometry({
    extentWidth: width,
    extentHeight: height,
    anchorX: 0,
    anchorY: 0,
    effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform: Object.freeze({
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      offsetEmu: Object.freeze({ x: 0, y: 0 }),
      extentEmu: EXTENT,
    }),
    presetGeometry: 'rect',
  });
  return Object.freeze({
    kind: 'inlineDrawing',
    drawingNodeId: 'n1',
    paragraphId: 'p1',
    ownerPartName: '/word/document.xml',
    start: 0,
    x: 0,
    y: 0,
    width,
    height,
    distL: 0,
    distR: 0,
    distT: 0,
    distB: 0,
    advanceStart: 0,
    advanceEnd: width,
    baselineOffset: 0,
    paintBounds: geometry.paintBounds,
    hitBounds: geometry.hitBounds,
    geometry,
    resource: Object.freeze({ kind: 'missing' as const, partName: null, reason: 'no-resource' }),
    accessibility: Object.freeze({ hidden: false, decorative: true, label: null }),
    hyperlinkHref: null,
    effects: Object.freeze({ grayscale: false, brightness: 0, contrast: 0 }),
    crop: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
    transform: Object.freeze({
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      offsetEmu: Object.freeze({ x: 0, y: 0 }),
      extentEmu: EXTENT,
    }),
    placeholderGraphicKind: 'textbox',
    vectorShape: vectorShape(),
  }) as unknown as InlineDrawingRecord;
}

describe('vector shape paint', () => {
  test('paints an SVG path with the validated fill and no placeholder card', () => {
    const element = paintDrawingRecord(
      document,
      shapeRecord(),
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: null, inertLinks: true },
      null
    );
    expect(element).not.toBeNull();
    expect(element!.className).toContain('docx-drawing-shape');
    expect(element!.querySelector('.docx-drawing-placeholder-card')).toBeNull();
    expect(element!.querySelector('img')).toBeNull();
    const svg = element!.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 6696075 47625');
    const path = svg!.querySelector('path');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('fill')).toBe('#000000');
    expect(path!.getAttribute('fill-rule')).toBe('evenodd');
    const d = path!.getAttribute('d')!;
    expect(d.startsWith('M6696075 38100L')).toBe(true);
    expect((d.match(/Z/g) ?? []).length).toBe(2);
  });
});
