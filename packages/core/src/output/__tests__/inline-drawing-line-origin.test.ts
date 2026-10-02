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
 * spacers flow left to right from there. A run advances the flow by its laid-out width.
 */
function paintedRunOffsets(layout: SemanticLayout, line: LineRecord): number[] {
  const host = document.createElement('div');
  paintSemanticLayout(host, layout, { scale: SCALE });
  const element = host.querySelector<HTMLElement>(`[data-line-id="${line.id}"]`)!;
  expect(element).not.toBeNull();
  let flow = 0;
  const offsets: number[] = [];
  for (const child of element.querySelectorAll<HTMLElement>(
    ':scope > .docx-inline-drawing-advance, :scope > .layout-run'
  )) {
    if (child.classList.contains('docx-inline-drawing-advance')) {
      flow += parseFloat(child.style.width) / SCALE;
      continue;
    }
    offsets.push(flow);
    flow += line.spans[offsets.length - 1]!.box.width;
  }
  expect(offsets).toHaveLength(line.spans.length);
  return offsets;
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
  function markX(layout: SemanticLayout): number {
    const host = document.createElement('div');
    paintSemanticLayout(host, layout, { scale: SCALE, showParagraphMarks: true });
    const fragment = layout.pages[0]!.fragments[0]!;
    const mark = host.querySelector<HTMLElement>('.docx-paragraph-mark')!;
    expect(mark).not.toBeNull();
    return fragment.box.x + parseFloat(mark.style.left) / SCALE;
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
});
