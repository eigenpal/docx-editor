// Task 8 fix round 3 — slab Minkowski, clip-before-expand, effectExtent precedence.

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  excludedIntervalsOnScanline,
  minkowskiExcludedIntervalsAtY,
  type WrapExclusionInput,
} from '../drawing-wrap.ts';
import type { DrawingPoint } from '../drawing-geometry.ts';
import { EMU_PER_POINT } from '../drawing-layout.ts';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/index.ts';
import { projectDrawingsInPart } from '../../store/package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

function anchoredSquareBothEffectXml(options: {
  anchorEffect: string;
  wrapEffect: string;
}): string {
  return `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/>${options.anchorEffect}<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0">${options.wrapEffect}</wp:wrapSquare><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>`;
}

describe('fix round 3 — vertical-band Minkowski slab projection', () => {
  const parallelogram: readonly DrawingPoint[] = Object.freeze([
    { x: 1, y: 0 },
    { x: 11, y: 0 },
    { x: 10, y: 1 },
    { x: 0, y: 1 },
  ]);

  test('diagonal parallelogram band union yields [0, 11] at y=0', () => {
    const excluded = minkowskiExcludedIntervalsAtY(
      parallelogram,
      0,
      { top: 1, right: 0, bottom: 0, left: 0 },
      'nonzero'
    );
    expect(excluded).toEqual([{ start: 0, end: 11 }]);
  });

  test('reversed winding parallelogram preserves [0, 11] under nonzero fill', () => {
    const reversed = Object.freeze([...parallelogram].reverse());
    const excluded = minkowskiExcludedIntervalsAtY(
      reversed,
      0,
      { top: 1, right: 0, bottom: 0, left: 0 },
      'nonzero'
    );
    expect(excluded).toEqual([{ start: 0, end: 11 }]);
  });

  test('moving disjoint passages union across vertical band', () => {
    const frame: readonly DrawingPoint[] = Object.freeze([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 5, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 2 },
      { x: 12, y: 6 },
      { x: 15, y: 6 },
      { x: 15, y: 8 },
      { x: 12, y: 8 },
      { x: 12, y: 6 },
    ]);
    const excluded = minkowskiExcludedIntervalsAtY(
      frame,
      3,
      { top: 2, right: 0, bottom: 2, left: 0 },
      'evenodd'
    );
    expect(excluded.length).toBeGreaterThanOrEqual(1);
    const mergedSpan = {
      start: Math.min(...excluded.map((i) => i.start)),
      end: Math.max(...excluded.map((i) => i.end)),
    };
    expect(mergedSpan.start).toBeLessThanOrEqual(8);
    expect(mergedSpan.end).toBeGreaterThanOrEqual(15);
  });

  test('U-channel through wrap closes at band boundaries (even-odd)', () => {
    const frame: readonly DrawingPoint[] = Object.freeze([
      { x: 50, y: 20 },
      { x: 150, y: 20 },
      { x: 150, y: 80 },
      { x: 50, y: 80 },
      { x: 50, y: 20 },
      { x: 80, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 40 },
    ]);
    const excluded = minkowskiExcludedIntervalsAtY(
      frame,
      50,
      { top: 0, right: 0, bottom: 0, left: 0 },
      'evenodd'
    );
    expect(excluded).toEqual([
      { start: 50, end: 80 },
      { start: 120, end: 150 },
    ]);
  });
});

describe('fix round 3 — preset clip before Minkowski expansion', () => {
  test('clearance outside clip stays available after wrap distances', () => {
    const triangle: readonly DrawingPoint[] = Object.freeze([
      { x: 100, y: 30 },
      { x: 140, y: 70 },
      { x: 60, y: 70 },
    ]);
    const clipPolygon: readonly DrawingPoint[] = Object.freeze([
      { x: 90, y: 25 },
      { x: 130, y: 25 },
      { x: 130, y: 55 },
      { x: 90, y: 55 },
    ]);
    const input: WrapExclusionInput = {
      mode: 'tight',
      contentBounds: { x: 60, y: 30, width: 80, height: 40 },
      polygon: triangle,
      clipPolygon,
      wrapDistances: { top: 0, right: 10, bottom: 0, left: 10 },
      effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      textSide: 'bothSides',
      contentLeft: 0,
      contentRight: 200,
    };
    const excluded = excludedIntervalsOnScanline(50, input);
    expect(excluded.every((interval) => interval.start >= 80 - 0.001)).toBe(true);
    expect(excluded.every((interval) => interval.end <= 140 + 0.001)).toBe(true);
    expect(excluded[0]!.start).toBeLessThan(90);
  });
});

describe('fix round 3 — wrapSquare effectExtent precedence', () => {
  test('wrapSquare child effectExtent wins when anchor also carries effectExtent', () => {
    const xml = anchoredSquareBothEffectXml({
      anchorEffect: '<wp:effectExtent l="25400" t="0" r="0" b="0"/>',
      wrapEffect: '<wp:effectExtent l="12700" t="0" r="0" b="0"/>',
    });
    const parsed = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    const projection = projectDrawingsInPart(parsed.part)[0]!;
    expect(projection.effectExtentEmu.left).toBe(12700);
  });

  test('wrapTopAndBottom child effectExtent wins over anchor fallback', () => {
    const xml = `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/><wp:effectExtent l="999" t="0" r="0" b="0"/><wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"><wp:effectExtent l="555" t="0" r="0" b="0"/></wp:wrapTopAndBottom><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>`;
    const parsed = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    const projection = projectDrawingsInPart(parsed.part)[0]!;
    expect(projection.effectExtentEmu.left).toBe(555);
  });
});
