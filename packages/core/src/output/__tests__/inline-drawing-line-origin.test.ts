// A line that opens with an inline picture starts at the picture, not at its first glyph.
//
// Paint places the line element at `contentX` and reserves each inline drawing's advance as a
// spacer in the inline flow before the text that follows it. An origin taken from the text
// alone started the line one picture width late, and the spacer then pushed the text a
// second picture width to the right (#1058).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  linesOf,
  type LineRecord,
  type SemanticLayout,
} from '../../layout/index.ts';
import { layoutContext, load } from '../../layout/__tests__/anchored-drawing-test-fixtures.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** An inline picture 100pt wide and 10pt tall. */
const drawing =
  '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="1270000" cy="127000"/><wp:docPr id="1" name="p1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="127000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
const PICTURE_WIDTH = 100;
const SCALE = 2;

const paragraph = (content: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;
const center = '<w:jc w:val="center"/>';
const rtlFirstLine = '<w:bidi/><w:ind w:firstLine="400"/>';
/** A 100pt square-wrapped float whose left edge is 120pt into the column. */
const floatAt120 =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>1524000</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="1270000" cy="1270000"/>' +
  '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
  '<wp:docPr id="2" name="float"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
const cell = (content: string) =>
  '<w:tbl><w:tblGrid><w:gridCol w:w="7200"/></w:tblGrid><w:tr><w:tc>' +
  `<w:tcPr><w:tcW w:w="7200" w:type="dxa"/></w:tcPr>${content}</w:tc></w:tr></w:tbl>`;

/** Lay out `body` and return the one line that holds the picture. */
function pictureLine(body: string): { layout: SemanticLayout; line: LineRecord } {
  const document = load(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`);
  const layout = layoutSemanticDocument(document, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(document),
  });
  const lines = linesOf(layout).filter((line) => (line.drawings?.length ?? 0) > 0);
  expect(lines).toHaveLength(1);
  return { layout, line: lines[0]! };
}

/**
 * Where inline flow puts each painted run, in points from the line's `contentX`.
 *
 * Paint opens the line element at `contentX` in its container's coordinates, and runs and
 * spacers flow left to right from there. A run advances the flow by its laid-out width, and a
 * shaped run is shifted from its flow position by its relative `left`.
 */
function paintedRunOffsets(layout: SemanticLayout, line: LineRecord): number[] {
  const host = document.createElement('div');
  paintSemanticLayout(host, layout, { scale: SCALE });
  const element = host.querySelector<HTMLElement>(`[data-line-id="${line.id}"]`)!;
  expect(element).not.toBeNull();
  let flow = 0;
  const offsets: number[] = [];
  for (const child of element.querySelectorAll<HTMLElement>(
    ':scope > .docx-inline-drawing-advance, :scope > .docx-wrap-advance, :scope > .layout-run'
  )) {
    if (!child.classList.contains('layout-run')) {
      flow += parseFloat(child.style.width) / SCALE;
      continue;
    }
    const shift = child.style.position === 'relative' ? parseFloat(child.style.left) / SCALE : 0;
    offsets.push(flow + shift);
    flow += line.spans[offsets.length - 1]!.box.width;
  }
  expect(offsets).toHaveLength(line.spans.length);
  return offsets;
}

/** `layout` with every span on every paragraph line marked as left-to-right shaped text. */
function withShapedSpans(layout: SemanticLayout): SemanticLayout {
  const shaping = { script: 'Latn', direction: 'ltr', level: 0, baseLevel: 0 } as const;
  return {
    ...layout,
    pages: layout.pages.map((page) => ({
      ...page,
      fragments: page.fragments.map((fragment) =>
        fragment.kind !== 'paragraph'
          ? fragment
          : {
              ...fragment,
              lines: fragment.lines.map((line) => ({
                ...line,
                spans: line.spans.map((span) => ({ ...span, style: { ...span.style, shaping } })),
              })),
            }
      ),
    })),
  };
}

function expectRunsAtLayout(layout: SemanticLayout, line: LineRecord): void {
  paintedRunOffsets(layout, line).forEach((offset, index) =>
    expect(offset).toBeCloseTo(line.spans[index]!.box.x - line.contentX, 5)
  );
}

describe('a line that opens with an inline picture', () => {
  for (const [name, body] of [
    ['picture and text in one run', paragraph(`<w:r>${drawing}<w:t>abcd</w:t></w:r>`)],
    ['picture and text in two runs', paragraph(`<w:r>${drawing}</w:r><w:r><w:t>abcd</w:t></w:r>`)],
    ['a centered line', paragraph(`<w:r>${drawing}<w:t>abcd</w:t></w:r>`, center)],
    ['a table cell', cell(paragraph(`<w:r>${drawing}<w:t>abcd</w:t></w:r>`, center))],
  ] as const) {
    test(`starts at the picture: ${name}`, () => {
      const { layout, line } = pictureLine(body);
      const picture = line.drawings![0]!;
      expect(line.contentX).toBeCloseTo(picture.advanceStart, 5);
      expect(line.spans[0]!.box.x).toBeCloseTo(picture.advanceStart + PICTURE_WIDTH, 5);
      expectRunsAtLayout(layout, line);
    });
  }

  test('keeps the jump a float forces between the picture and the text', () => {
    const { layout, line } = pictureLine(
      paragraph(`${floatAt120}<w:r>${drawing}<w:t>abcd</w:t></w:r>`)
    );
    const picture = line.drawings![0]!;
    // The word does not fit between the picture and the float, so it resumes after the float.
    expect(line.spans[0]!.box.x).toBeCloseTo(220, 5);
    expect(line.spans[0]!.wrapAdvanceBefore).toBeCloseTo(220 - picture.advanceEnd, 5);
    expectRunsAtLayout(layout, line);
  });

  test('keeps the jump a float forces after a picture between two words', () => {
    const { layout, line } = pictureLine(
      paragraph(`${floatAt120}<w:r><w:t xml:space="preserve">a </w:t>${drawing}<w:t>bc</w:t></w:r>`)
    );
    expect(line.spans.at(-1)!.box.x).toBeCloseTo(220, 5);
    expectRunsAtLayout(layout, line);
  });

  test('a right-to-left first line indents the picture with its text', () => {
    // The picture reads in the paragraph's direction, so it stands at the right, inside the
    // 20pt first-line indent on that side, and the text after it stands to its left.
    const { layout, line } = pictureLine(
      paragraph(`<w:r>${drawing}<w:t>abcd</w:t></w:r>`, rtlFirstLine)
    );
    const picture = line.drawings![0]!;
    expect(picture.advanceEnd).toBeCloseTo(468 - 20, 5);
    expect(line.spans[0]!.box.x + line.spans[0]!.box.width).toBeCloseTo(picture.advanceStart, 5);
    expect(line.contentX).toBeCloseTo(line.spans[0]!.box.x, 5);
    expectRunsAtLayout(layout, line);
  });

  test('shaped runs count the picture spacer in the flow they are placed from', () => {
    // Shaped runs take a relative offset from where inline flow left them, and that flow
    // holds the picture's spacer. The shaping is stamped on here so the rule is held for any
    // picture position, not only the ones bidi reordering produces.
    const { layout, line } = pictureLine(
      paragraph(`<w:r><w:t xml:space="preserve">ab </w:t>${drawing}<w:t>cd</w:t></w:r>`)
    );
    const shaped = withShapedSpans(layout);
    const shapedLine = linesOf(shaped).find((candidate) => candidate.id === line.id)!;
    expect(shapedLine.spans.every((span) => span.style.shaping !== undefined)).toBe(true);
    expectRunsAtLayout(shaped, shapedLine);
  });

  test('a centered line centers the picture and the text as one unit', () => {
    const { line } = pictureLine(paragraph(`<w:r>${drawing}<w:t>abcd</w:t></w:r>`, center));
    const last = line.spans.at(-1)!;
    const used = last.box.x + last.box.width - line.contentX;
    expect(line.contentX - line.box.x).toBeCloseTo((line.box.width - used) / 2, 5);
  });

  test('text before the picture keeps its own origin', () => {
    const { layout, line } = pictureLine(
      paragraph(`<w:r><w:t>ab</w:t>${drawing}<w:t>cd</w:t></w:r>`)
    );
    expect(line.contentX).toBeCloseTo(line.spans[0]!.box.x, 5);
    expectRunsAtLayout(layout, line);
  });

  test('a line with only a picture starts at the picture', () => {
    const { line } = pictureLine(paragraph(`<w:r>${drawing}</w:r>`, center));
    expect(line.spans).toHaveLength(0);
    expect(line.contentX).toBeCloseTo(line.drawings![0]!.advanceStart, 5);
  });
});

describe('the paragraph mark after an inline picture', () => {
  /** The mark's x in points, in the same space as the line's records. */
  /**
   * The mark's x in points, in the same space as the line's records. It sits in its line's
   * inline flow, which ends at the line's right content edge, and `left` moves it from there.
   */
  function markX(layout: SemanticLayout): number {
    const host = document.createElement('div');
    paintSemanticLayout(host, layout, { scale: SCALE, showParagraphMarks: true });
    const line = linesOf(layout).at(-1)!;
    const mark = host.querySelector<HTMLElement>('.docx-paragraph-mark')!;
    expect(mark.parentElement?.dataset.lineId).toBe(line.id);
    let flowEnd = line.contentX;
    for (const span of line.spans) flowEnd = Math.max(flowEnd, span.box.x + span.box.width);
    for (const picture of line.drawings ?? []) flowEnd = Math.max(flowEnd, picture.advanceEnd);
    return flowEnd + parseFloat(mark.style.left) / SCALE;
  }

  for (const [name, body] of [
    ['a picture that ends a line of text', paragraph(`<w:r><w:t>ab</w:t>${drawing}</w:r>`)],
    ['a line with only a picture', paragraph(`<w:r>${drawing}</w:r>`, center)],
  ] as const) {
    test(`follows the picture: ${name}`, () => {
      const { layout, line } = pictureLine(body);
      expect(markX(layout)).toBeCloseTo(line.drawings![0]!.advanceEnd, 5);
    });
  }

  test('follows the text after a picture', () => {
    const { layout, line } = pictureLine(paragraph(`<w:r>${drawing}<w:t>ab</w:t></w:r>`));
    const last = line.spans.at(-1)!;
    expect(markX(layout)).toBeCloseTo(last.box.x + last.box.width, 5);
  });

  test('follows a picture that jumped a float, measured through the painted flow', () => {
    // 66pt of text and a 100pt picture do not fit before the float at 120pt, so the picture
    // jumps to 220pt. No span carries that jump: the picture's spacer must reach its far
    // edge, or the mark seated at the end of the flow lands inside the float.
    const { layout, line } = pictureLine(
      paragraph(`${floatAt120}<w:r><w:t>abcdefghijk</w:t>${drawing}</w:r>`)
    );
    const picture = line.drawings![0]!;
    expect(picture.advanceStart).toBeCloseTo(220, 5);
    const host = document.createElement('div');
    paintSemanticLayout(host, layout, { scale: SCALE, showParagraphMarks: true });
    const element = host.querySelector<HTMLElement>(`[data-line-id="${line.id}"]`)!;
    let flow = 0;
    let spanIndex = 0;
    for (const child of element.children) {
      const item = child as HTMLElement;
      if (item.classList.contains('docx-paragraph-mark')) {
        expect(flow + parseFloat(item.style.left) / SCALE).toBeCloseTo(
          picture.advanceEnd - line.contentX,
          5
        );
        return;
      }
      if (item.classList.contains('layout-run')) flow += line.spans[spanIndex++]!.box.width;
      else if (item.style.display === 'inline-block') flow += parseFloat(item.style.width) / SCALE;
    }
    throw new Error('no paragraph mark in the line');
  });

  test("sits on the line's baseline at the paragraph mark's own size", () => {
    // A tall picture line has its baseline at the picture's foot. The mark joins the line's
    // inline flow, so it shares that baseline, and its size is the mark's, not the text's.
    const { layout } = pictureLine(
      paragraph(`<w:r>${drawing}<w:t>ab</w:t></w:r>`, '<w:rPr><w:sz w:val="48"/></w:rPr>')
    );
    const host = document.createElement('div');
    paintSemanticLayout(host, layout, { scale: SCALE, showParagraphMarks: true });
    const mark = host.querySelector<HTMLElement>('.docx-paragraph-mark')!;
    expect(mark.parentElement?.classList.contains('docx-line')).toBe(true);
    expect(mark.style.verticalAlign).toBe('baseline');
    expect(mark.style.lineHeight).toBe('0');
    expect(mark.style.fontSize).toBe(`${24 * SCALE}px`);
  });
});
