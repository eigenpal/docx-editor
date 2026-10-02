// Inline pictures in right-to-left paragraphs.
//
// A picture is its U+FFFC in the paragraph's text (UAX #9 class ON). It joins the direction of
// the runs on both sides when they agree, and takes the paragraph's direction otherwise. So
// in a right-to-left paragraph a leading picture stands at the right with the text after it
// to its left, a picture between two Hebrew words stays between them in their order, and a
// picture before left-to-right text still stands to the right of it.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument, linesOf, type LineRecord } from '../index.ts';
import { caretBoxOnLine, hitTestPage } from '../semantic-hit-test.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** An inline picture 100pt wide and 30pt tall, in a run with no direction of its own. */
const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="1270000" cy="381000"/><wp:docPr id="1" name="p1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
/** The same picture 4pt tall, so a 14pt line leaves room above it. */
const shortPicture = picture.replaceAll('381000', '50800');
const hebrew = (text: string) =>
  `<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const latin = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const CONTENT_RIGHT = 468;

function lay(content: string, pPr = '<w:bidi/>', before = '') {
  const part = load(
    `<w:document ${NAMESPACES}><w:body>${before}<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>` +
      '</w:body></w:document>'
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const line = linesOf(layout).find((record) => record.drawings?.length)!;
  return { layout, line, drawing: line.drawings![0]! };
}

const spanAt = (line: LineRecord, start: number) =>
  line.spans.find((span) => span.range.start === start)!;

describe('a right-to-left paragraph', () => {
  test('a leading picture stands at the right, and the text after it to its left', () => {
    const { line, drawing } = lay(picture + hebrew('שלום עולם'));
    expect(drawing.bidiLevel).toBe(1);
    expect(drawing.advanceEnd).toBeCloseTo(CONTENT_RIGHT, 5);
    for (const span of line.spans) {
      expect(span.box.x + span.box.width).toBeLessThanOrEqual(drawing.advanceStart + 0.001);
    }
    // The text itself still reads right to left: its first word is its rightmost.
    expect(spanAt(line, 1).box.x).toBeGreaterThan(spanAt(line, 6).box.x);
  });

  test('a picture between two words stays between them, in their order', () => {
    const { line, drawing } = lay(hebrew('שלום') + picture + hebrew('עולם'));
    const first = spanAt(line, 0);
    const second = spanAt(line, 5);
    expect(first.box.x).toBeCloseTo(drawing.advanceEnd, 5);
    expect(second.box.x + second.box.width).toBeCloseTo(drawing.advanceStart, 5);
  });

  test('a picture before left-to-right text stands to its right', () => {
    const { line, drawing } = lay(picture + latin('abc'));
    expect(drawing.bidiLevel).toBe(1);
    expect(drawing.advanceEnd).toBeCloseTo(CONTENT_RIGHT, 5);
    expect(spanAt(line, 1).box.x + spanAt(line, 1).box.width).toBeCloseTo(drawing.advanceStart, 5);
  });

  test('a picture alone stands at the right', () => {
    const { drawing } = lay(picture);
    expect(drawing.advanceEnd).toBeCloseTo(CONTENT_RIGHT, 5);
  });

  test("the picture's logical start is its right edge", () => {
    const { line, drawing } = lay(picture + hebrew('שלום עולם'));
    expect(caretBoxOnLine(line, 0, undefined).x).toBeCloseTo(drawing.advanceEnd, 5);
    // The text that starts after the picture owns that caret, at the picture's left edge.
    expect(caretBoxOnLine(line, 1, undefined).x).toBeCloseTo(drawing.advanceStart, 5);
  });

  test('a point over the left half of the picture means after it', () => {
    const { layout, line, drawing } = lay(shortPicture);
    const y = line.box.y + 1;
    expect(y).toBeLessThan(drawing.hitBounds.y);
    const at = (x: number) => hitTestPage(layout, 0, { x, y })?.position.offset;
    expect(at(drawing.advanceStart + 10)).toBe(1);
    expect(at(drawing.advanceEnd - 10)).toBe(0);
  });
});

test('a left-to-right paragraph keeps its picture in reading order beside Hebrew text', () => {
  const { line, drawing } = lay(latin('ab ') + picture + hebrew('שלום'), '');
  expect(drawing.bidiLevel).toBe(0);
  expect(spanAt(line, 0).box.x).toBeLessThan(drawing.advanceStart);
  expect(spanAt(line, 4).box.x).toBeCloseTo(drawing.advanceEnd, 5);
});

test('two pictures alone in a right-to-left paragraph read right to left', () => {
  const { line } = lay(picture + picture);
  const [first, second] = line.drawings!;
  expect(first!.advanceEnd).toBeCloseTo(CONTENT_RIGHT, 5);
  expect(second!.advanceEnd).toBeCloseTo(first!.advanceStart, 5);
});
