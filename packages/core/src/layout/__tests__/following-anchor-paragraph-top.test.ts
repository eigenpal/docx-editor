// A reflow pass moves a following picture's zone with the paragraph top it predicts
// (`following-anchor-tops.ts`). That move is right only for a picture whose place follows its
// paragraph's top one for one, so only such a zone carries `paragraphTop`.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { collectExclusionZonesByPage, type ExclusionZone } from '../drawing-exclusion.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PT = 12700;

/** A paragraph with a square-wrapped 60pt picture, placed as `vertical` says, and some text. */
function paragraph(
  id: number,
  vertical: string,
  options: { simplePos?: boolean; pageBreakBefore?: boolean } = {}
): string {
  const size = 60 * EMU_PER_PT;
  return (
    `<w:p>${options.pageBreakBefore ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}<w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="${options.simplePos ? 1 : 0}" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
    `<wp:simplePos x="0" y="${300 * EMU_PER_PT}"/>` +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    vertical +
    `<wp:extent cx="${size}" cy="${size}"/><wp:wrapSquare wrapText="bothSides"/>` +
    `<wp:docPr id="${id}" name="pic ${id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>' +
    `<w:r><w:t>${'words of text '.repeat(12)}</w:t></w:r></w:p>`
  );
}

const offset = (points: number) =>
  `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${points * EMU_PER_PT}</wp:posOffset></wp:positionV>`;

/** The zone of picture `id` (its docPr id) in `zones`, on any page. */
function zoneOf(zones: ReadonlyMap<number, readonly ExclusionZone[]>, id: number): ExclusionZone {
  const all = [...zones.values()].flat();
  const zone = all.find((candidate) => candidate.drawingNodeId === drawingIds[id - 1]);
  if (!zone) throw new Error(`no zone for picture ${id}`);
  return zone;
}

const part = load(
  `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
    paragraph(1, offset(0)) +
    paragraph(2, offset(-10)) +
    paragraph(3, offset(0), { simplePos: true }) +
    paragraph(4, '<wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV>') +
    // The first paragraph of its page: a place above the content top stops at that top.
    paragraph(5, offset(-30), { pageBreakBefore: true }) +
    paragraph(
      6,
      '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>'
    ) +
    '</w:body></w:document>'
);
const context = layoutContext(part);
const layout = layoutSemanticDocument(part, 1, {
  measurer: createFixedMeasurer(6, 14),
  compatibilityMode: 15,
  inlineDrawingLayout: context,
});
const drawingIds = layout.pages
  .flatMap((page) => page.anchoredDrawings ?? [])
  .map((drawing) => drawing.drawingNodeId);
const zones = collectExclusionZonesByPage(layout.pages, context, 468);

describe('the paragraph top of a following picture zone', () => {
  test('is the frame origin of a picture at an offset below its paragraph', () => {
    expect(drawingIds).toHaveLength(6);
    const drawings = layout.pages.flatMap((page) => page.anchoredDrawings ?? []);
    for (const id of [1, 2]) {
      const zone = zoneOf(zones, id);
      expect(zone.paragraphTop).toBe(drawings[id - 1]!.verticalFrameOrigin);
    }
  });

  test('is absent where the place does not follow the paragraph top one for one', () => {
    // A simple position, an alignment, a place clamped to the content top, and a page frame.
    for (const id of [3, 4, 5, 6]) expect(zoneOf(zones, id).paragraphTop).toBeUndefined();
    const clamped = layout.pages.flatMap((page) => page.anchoredDrawings ?? [])[4]!;
    expect(clamped.verticalFrame).toBe('paragraph');
    expect(clamped.y).toBeGreaterThan(clamped.verticalFrameOrigin - 30);
  });
});
