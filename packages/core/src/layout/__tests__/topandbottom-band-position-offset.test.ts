// A `wp:wrapTopAndBottom` band clears the drawing, so it starts at the drawing's own top.
// The painted geometry applies a paragraph-framed `wp:positionV` `wp:posOffset`; the band used
// to ignore it and resume text at the anchor line plus the extent, which is too early by the
// offset. Word resumes text at the drawing's bottom plus `distB`.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { anchoredDrawingsOf, paragraphFragmentsOf } from '../semantic-records.ts';
import { topAndBottomBandAnchorY } from '../top-and-bottom-clearance.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const measurer = createFixedMeasurer(6, 14);

/** 914400 EMU is 72 pt square. */
const EXTENT = 914400;

function band(options: { readonly posOffsetEmu: number; readonly distBEmu: number }): string {
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="${options.distBEmu}" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${options.posOffsetEmu}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${EXTENT}" cy="${EXTENT}"/>` +
    `<wp:wrapTopAndBottom distT="0" distB="${options.distBEmu}"/>` +
    '<wp:docPr id="1" name="band"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="${EXTENT}" cy="${EXTENT}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

function documentWithBand(options: {
  readonly posOffsetEmu: number;
  readonly distBEmu: number;
}): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body>' +
    `<w:p>${band(options)}<w:r><w:t>anchor</w:t></w:r></w:p>` +
    '<w:p><w:r><w:t>after</w:t></w:r></w:p>' +
    '</w:body></w:document>'
  );
}

function measure(options: { readonly posOffsetEmu: number; readonly distBEmu: number }): {
  readonly drawingBottom: number;
  readonly resumeY: number;
} {
  const part = load(documentWithBand(options));
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  });
  const page = layout.pages[0]!;
  const drawing = anchoredDrawingsOf(page)[0]!;
  const fragments = paragraphFragmentsOf(page);
  return {
    drawingBottom: drawing.y + drawing.paintBounds.height,
    resumeY: fragments[0]!.box.y,
  };
}

describe('a topAndBottom band starts at the drawing, not at the anchor line', () => {
  test('with no offset the band bottom is the anchor line plus the extent', () => {
    const { drawingBottom, resumeY } = measure({ posOffsetEmu: 0, distBEmu: 0 });
    expect(drawingBottom).toBeCloseTo(72, 6);
    expect(resumeY).toBeCloseTo(72, 6);
  });

  test('a paragraph-framed positionV offset moves the resumed text with the drawing', () => {
    const { drawingBottom, resumeY } = measure({ posOffsetEmu: 127000, distBEmu: 0 });
    expect(drawingBottom).toBeCloseTo(82, 6);
    expect(resumeY).toBeCloseTo(82, 6);
  });

  test('distB adds to the band below the drawing without moving the drawing', () => {
    const { drawingBottom, resumeY } = measure({ posOffsetEmu: 0, distBEmu: 127000 });
    expect(drawingBottom).toBeCloseTo(72, 6);
    expect(resumeY).toBeCloseTo(82, 6);
  });

  test('an offset and distB both count', () => {
    const { drawingBottom, resumeY } = measure({ posOffsetEmu: 127000, distBEmu: 127000 });
    expect(drawingBottom).toBeCloseTo(82, 6);
    expect(resumeY).toBeCloseTo(92, 6);
  });
});

describe('the band anchor keeps the anchor line for frames it cannot resolve', () => {
  const vertical = (relativeFrom: string, align: string | null, offsetEmu: number | null) =>
    Object.freeze({ relativeFrom, align, offsetEmu });

  test('paragraph and line frames add the offset', () => {
    expect(topAndBottomBandAnchorY(100, vertical('paragraph', null, 127000))).toBeCloseTo(110, 6);
    expect(topAndBottomBandAnchorY(100, vertical('line', null, 127000))).toBeCloseTo(110, 6);
  });

  test('page-relative frames do not resolve against the anchor line', () => {
    expect(topAndBottomBandAnchorY(100, vertical('page', null, 127000))).toBe(100);
    expect(topAndBottomBandAnchorY(100, vertical('margin', null, 127000))).toBe(100);
    expect(topAndBottomBandAnchorY(100, vertical('topMargin', null, 127000))).toBe(100);
  });

  test('an alignment needs a frame box the paragraph does not have while breaking', () => {
    expect(topAndBottomBandAnchorY(100, vertical('paragraph', 'center', null))).toBe(100);
    expect(topAndBottomBandAnchorY(100, vertical('paragraph', 'bottom', 127000))).toBe(100);
  });

  test('a missing or unreadable positionV keeps the anchor line', () => {
    expect(topAndBottomBandAnchorY(100, null)).toBe(100);
    expect(topAndBottomBandAnchorY(100, vertical('paragraph', null, null))).toBe(100);
    expect(topAndBottomBandAnchorY(100, vertical('paragraph', null, Number.NaN))).toBe(100);
  });
});
