// A point over a leading inline picture's advance, but outside the picture itself.
//
// A line taller than its picture leaves a band above it that the picture does not cover. A
// point there, over the picture's half nearer its end, means the position after the picture.
// The hit test used to treat everything left of the first text as the line start, so the
// caret went before the picture while its x was drawn after it.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** An inline picture 100pt wide and 4pt tall: shorter than the 14pt text beside it. */
const drawing =
  '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="1270000" cy="50800"/><wp:docPr id="1" name="p1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="50800"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';

/**
 * A 100pt square-wrapped float whose left edge is 120pt into the column. Its 20pt left wrap
 * distance leaves a strip before it that text skips but the float does not cover.
 */
const floatAt120 =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="254000" distR="0" simplePos="0" ' +
  'behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>1524000</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="1270000" cy="1270000"/>' +
  '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="254000" distR="0"/>' +
  '<wp:docPr id="2" name="float"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';

function pictureLine(content = `<w:r>${drawing}<w:t>abcd</w:t></w:r>`) {
  const part = load(
    `<w:document ${NAMESPACES}><w:body><w:p>${content}</w:p></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const line = linesOf(layout)[0]!;
  const picture = line.drawings![0]!;
  // A band above the picture, still inside the line.
  const y = line.box.y + 0.5;
  expect(y).toBeLessThan(picture.hitBounds.y);
  return { layout, line, picture, y };
}

describe('a point over a leading picture but outside it', () => {
  test('nearer the picture end, it is the position after the picture', () => {
    const { layout, line, picture, y } = pictureLine();
    const hit = hitTestPage(layout, 0, { x: picture.advanceEnd - 10, y });
    expect(hit?.position).toEqual({ paragraphId: line.range.paragraphId, offset: 1 });
  });

  test('nearer the picture start, it is the line start', () => {
    const { layout, line, picture, y } = pictureLine();
    const hit = hitTestPage(layout, 0, { x: picture.advanceStart + 10, y });
    expect(hit?.position).toEqual({ paragraphId: line.range.paragraphId, offset: 0 });
  });
});

describe('a point over a trailing picture but outside it', () => {
  // The same rule at the other end of the line: the text no longer ends the line there.
  test('takes the side of the picture it is nearer', () => {
    const { layout, line, picture, y } = pictureLine(`<w:r><w:t>abcd</w:t>${drawing}</w:r>`);
    const at = (x: number) => hitTestPage(layout, 0, { x, y })?.position.offset;
    expect(at(picture.advanceStart + 10)).toBe(4);
    expect(at(picture.advanceEnd - 10)).toBe(5);
    expect(line.range.end).toBe(5);
  });
});

describe('a point in the float jump after a leading picture', () => {
  test('reports the x the caret for that position draws at', () => {
    const { layout, line, picture } = pictureLine(
      `${floatAt120}<w:r>${drawing}<w:t>abcd</w:t></w:r>`
    );
    expect(line.spans[0]!.box.x).toBeCloseTo(220, 5);
    const hit = hitTestPage(layout, 0, { x: 110, y: picture.hitBounds.y + 1 });
    expect(hit?.position.offset).toBe(picture.start + 1);
    expect(hit?.caret.x).toBeCloseTo(picture.advanceEnd, 5);
  });

  test('is not claimed by a later picture on the same line', () => {
    // A picture after the text used to win any point left of it once the loop reached it.
    const { layout, line, picture } = pictureLine(
      `${floatAt120}<w:r>${drawing}<w:t>ab</w:t>${drawing}</w:r>`
    );
    expect(line.drawings).toHaveLength(2);
    const hit = hitTestPage(layout, 0, { x: 110, y: picture.hitBounds.y + 1 });
    expect(hit?.position.offset).toBe(picture.start + 1);
  });
});
