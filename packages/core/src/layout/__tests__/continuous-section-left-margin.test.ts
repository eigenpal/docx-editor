// A section that starts with `w:type="continuous"` (CT_SectType, ST_SectionMark; ECMA-376
// Part 1, 17.6.22 and 17.18.77) begins on the sheet of the section before it. Its own `w:pgMar`
// (CT_PageMar, 17.6.11) gives the left edge of its text from its first line: paragraphs, tables,
// and indents on the shared sheet measure from that edge. The sheet keeps the content box of the
// section that opened it. A DrawingML anchor positioned from the margin (ST_RelFromH, 20.4.3.4)
// stays on the margins of the shared sheet.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/index.ts';
import {
  caretAt,
  createFixedMeasurer,
  createLayoutSession,
  hitTestSemantic,
  layoutSemanticDocument,
  type LayoutSession,
} from '../index.ts';
import type {
  BlockFragmentRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';
import { translateBlocksX } from '../continued-section-origin.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS =
  `xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const measurer = createFixedMeasurer(6, 14);
const LINE = '<w:spacing w:after="0" w:line="280" w:lineRule="exact"/>';

const p = (text: string, extra = '') =>
  `<w:p><w:pPr>${LINE}${extra}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
function section(type: string | undefined, left: number, right = 1440, columns = ''): string {
  return (
    `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="1440" w:right="${right}" w:bottom="1440" w:left="${left}" w:header="720" w:footer="720"/>` +
    `${columns}</w:sectPr>`
  );
}
const TABLE =
  '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>' +
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p('CellA')}</w:tc>` +
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p('CellB')}</w:tc></w:tr></w:tbl>`;

function part(body: string): OoxmlPart {
  const parsed = readOoxmlPart(`<w:document ${NS}><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
/** A first section with 72pt side margins, then `second` with its own section properties. */
const twoSections = (second: string, sectPr: string, firstLeft = 1440): OoxmlPart =>
  part(p('First', section(undefined, firstLeft)) + second + sectPr);
const lay = (document: OoxmlPart, revision = 0, session?: LayoutSession): SemanticLayout =>
  layoutSemanticDocument(document, revision, { measurer, ...(session ? { session } : {}) });

function paragraphOf(blocks: readonly BlockFragmentRecord[], label: string) {
  const walk = (list: readonly BlockFragmentRecord[]): ParagraphFragmentRecord | undefined => {
    for (const block of list) {
      if (block.kind === 'paragraph') {
        if (block.lines[0]?.spans.some((span) => span.text.startsWith(label))) return block;
      } else
        for (const row of block.rows)
          for (const cell of row.cells) {
            const found = walk(cell.blocks);
            if (found) return found;
          }
    }
    return undefined;
  };
  const found = walk(blocks);
  if (!found) throw new Error(`no paragraph ${label}`);
  return found;
}
const textX = (layout: SemanticLayout, label: string, page = 0): number =>
  paragraphOf(layout.pages[page]!.fragments, label).lines[0]!.spans[0]!.box.x;

describe('left margin of a continuous section on the shared sheet', () => {
  test('text, indents, and tables start at the wider left margin of the section', () => {
    const layout = lay(
      twoSections(
        p('Second') + p('Indented', '<w:ind w:left="720"/>') + TABLE,
        section('continuous', 2880)
      )
    );
    expect(layout.pages).toHaveLength(1);
    const page = layout.pages[0]!;
    // The sheet keeps the first section's content box: 72pt from the sheet's left edge.
    expect(page.contentBox.x - page.box.x).toBe(72);
    expect(textX(layout, 'First')).toBe(0);
    // 144pt margin on a 72pt content origin.
    const second = paragraphOf(page.fragments, 'Second');
    expect(second.box.x).toBe(72);
    expect(second.lines[0]!.box.x).toBe(72);
    expect(second.lines[0]!.contentX).toBe(72);
    expect(textX(layout, 'Second')).toBe(72);
    expect(textX(layout, 'Indented')).toBe(72 + 36);
    const table = page.fragments.find(
      (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
    )!;
    const [cellA, cellB] = table.rows[0]!.cells;
    const control = lay(twoSections(p('Second') + TABLE, section('continuous', 1440, 2880)));
    const controlTable = control.pages[0]!.fragments.find(
      (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
    )!;
    // Every box of the table is 72pt right of the same table in a section that keeps the margin.
    expect(table.box.x).toBe(controlTable.box.x + 72);
    expect(table.rows[0]!.box.x).toBe(controlTable.rows[0]!.box.x + 72);
    expect(cellA!.box.x).toBe(controlTable.rows[0]!.cells[0]!.box.x + 72);
    expect(cellB!.box.x - cellA!.box.x).toBe(100);
    expect(textX(layout, 'CellA')).toBe(textX(control, 'CellA') + 72);
    expect(textX(layout, 'CellB')).toBe(textX(control, 'CellB') + 72);
    expect(table.columnEdges).toEqual(controlTable.columnEdges);
    // The wrap width is the section's own: 612 - 144 - 72.
    expect(second.box.width).toBe(396);
  });

  test('text starts left of the sheet content box for a narrower left margin', () => {
    const layout = lay(twoSections(p('Second'), section('continuous', 720)));
    expect(textX(layout, 'Second')).toBe(-36);
  });

  test('columns move with the left margin', () => {
    const words = `Second ${'word '.repeat(400)}`;
    const columns = '<w:cols w:num="2" w:space="720" w:sep="1"/>';
    const same = lay(twoSections(p(words), section('continuous', 1440, 2880, columns)));
    const moved = lay(twoSections(p(words), section('continuous', 2880, 1440, columns)));
    const lineXs = (layout: SemanticLayout) =>
      layout.pages[0]!.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.map((line) => line.box.x) : []
      );
    const base = [...new Set(lineXs(same))].sort((a, b) => a - b);
    const shifted = [...new Set(lineXs(moved))].sort((a, b) => a - b);
    expect(base.length).toBeGreaterThan(1);
    // The same columns, 72pt further right; the first section's line stays at 0.
    expect(shifted).toEqual([0, ...base.map((x) => x + 72)]);
    const separators = (layout: SemanticLayout) =>
      (layout.pages[0]!.columnSeparators ?? []).map((box) => box.x);
    expect(separators(same)).toHaveLength(1);
    expect(separators(moved)).toEqual(separators(same).map((x) => x + 72));
  });

  test('the next sheet of the section has its own content box', () => {
    const lines = Array.from({ length: 60 }, (_, index) => p(`L${index}`)).join('');
    const layout = lay(twoSections(lines, section('continuous', 2880)));
    expect(layout.pages).toHaveLength(2);
    expect(textX(layout, 'L0')).toBe(72);
    const next = layout.pages[1]!;
    expect(next.contentBox.x - next.box.x).toBe(144);
    expect(next.fragments[0]!.box.x).toBe(0);
  });

  test('sections with one left margin, and a section on a new page, do not move', () => {
    const same = lay(twoSections(p('Second') + TABLE, section('continuous', 1440, 2880)));
    expect(textX(same, 'Second')).toBe(0);
    expect(paragraphOf(same.pages[0]!.fragments, 'Second').box.x).toBe(0);
    const nextPage = lay(twoSections(p('Second'), section('nextPage', 2880)));
    expect(nextPage.pages).toHaveLength(2);
    expect(textX(nextPage, 'Second', 1)).toBe(0);
  });

  test('the caret and a pointer hit follow the moved line', () => {
    const layout = lay(twoSections(p('Second'), section('continuous', 2880)));
    const second = paragraphOf(layout.pages[0]!.fragments, 'Second');
    const line = second.lines[0]!;
    const control = lay(twoSections(p('Second'), section('continuous', 1440, 2880)));
    const controlId = paragraphOf(control.pages[0]!.fragments, 'Second').paragraphId;
    for (const offset of [0, 3, 6]) {
      const caret = caretAt(layout, { paragraphId: second.paragraphId, offset }, measurer)!;
      const unmoved = caretAt(control, { paragraphId: controlId, offset }, measurer)!;
      expect(caret.x).toBeCloseTo(unmoved.x + 72, 6);
      expect(caret.y).toBe(unmoved.y);
    }
    expect(caretAt(layout, { paragraphId: second.paragraphId, offset: 0 }, measurer)!.x).toBe(72);
    const afterThree = caretAt(layout, { paragraphId: second.paragraphId, offset: 3 }, measurer)!;
    const hit = hitTestSemantic(layout, {
      x: afterThree.x + 1,
      y: line.box.y + line.box.height / 2,
      pageIndex: 0,
    })!;
    expect(hit.position).toEqual({ paragraphId: second.paragraphId, offset: 3 });
  });

  test('an incremental pass after an edit equals a full pass', () => {
    const before = twoSections(p('Second') + TABLE + p('Tail'), section('continuous', 2880));
    const after = twoSections(p('Second edited') + TABLE + p('Tail'), section('continuous', 2880));
    const session = createLayoutSession();
    const first = lay(before, 0, session);
    // A pass without a change keeps every record of the shared sheet.
    const again = lay(before, 0, session);
    expect(again.pages[0]!.fragments).toHaveLength(first.pages[0]!.fragments.length);
    again.pages[0]!.fragments.forEach((fragment, index) =>
      expect(fragment).toBe(first.pages[0]!.fragments[index]!)
    );
    const incremental = lay(after, 1, session);
    const full = lay(after, 1);
    const shape = (layout: SemanticLayout) =>
      JSON.stringify(
        layout.pages.map((page) => ({
          contentBox: page.contentBox,
          fragments: page.fragments.map((fragment) =>
            fragment.kind === 'paragraph'
              ? { box: fragment.box, lines: fragment.lines.map((line) => [line.box, line.spans]) }
              : { box: fragment.box, rows: fragment.rows }
          ),
        }))
      );
    expect(shape(incremental)).toBe(shape(full));
    expect(textX(incremental, 'Second')).toBe(72);
    expect(textX(incremental, 'Tail')).toBe(72);
  });
});

describe('several sections and earlier floats on one sheet', () => {
  test('each continued section takes its own left margin on the same sheet', () => {
    const layout = lay(
      part(
        p('First', section(undefined, 1440)) +
          p('Second', section('continuous', 2880)) +
          p('Third', section('continuous', 720)) +
          p('Fourth') +
          section('continuous', 2160)
      )
    );
    expect(layout.pages).toHaveLength(1);
    expect(textX(layout, 'First')).toBe(0);
    expect(textX(layout, 'Second')).toBe(72);
    expect(textX(layout, 'Third')).toBe(-36);
    expect(textX(layout, 'Fourth')).toBe(36);
  });

  test('text wraps beside a floating table of the earlier section in sheet coordinates', () => {
    // A 144pt-wide table at the right margin of the first section, with a 9pt wrap distance.
    const float =
      '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
      'w:horzAnchor="margin" w:tblpXSpec="right" w:tblpY="1"/><w:tblW w:w="2880" w:type="dxa"/>' +
      '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid>' +
      `<w:tr><w:trPr><w:trHeight w:val="2880" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr>${p('cell')}</w:tc></w:tr></w:tbl>`;
    const words = `Second ${'word '.repeat(60)}`;
    const layout = lay(
      part(
        p('First') +
          float +
          p('', section(undefined, 1440)) +
          p(words) +
          section('continuous', 2880)
      )
    );
    const page = layout.pages[0]!;
    const table = page.fragments.find(
      (fragment): fragment is TableFragmentRecord =>
        fragment.kind === 'table' && isOutOfFlowTableFragment(fragment)
    )!;
    // The float stays at the first section's right margin: 468pt content width, 144pt table.
    expect(Math.round(table.box.x)).toBe(325);
    const second = paragraphOf(page.fragments, 'Second');
    const first = second.lines[0]!;
    expect(first.box.y).toBeLessThan(table.box.y + table.box.height);
    expect(first.spans[0]!.box.x).toBe(72);
    const right = Math.max(...first.spans.map((span) => span.box.x + span.box.width));
    expect(right).toBeLessThanOrEqual(table.box.x - 9 + 0.001);
    // Beside the float the line is shorter than the section's own 396pt column.
    expect(right - 72).toBeGreaterThan(200);
  });

  test('right-to-left list marker pieces move with their marker', () => {
    const box = { x: 10, y: 0, width: 20, height: 14 };
    const fragment = {
      ...paragraphOf(
        lay(twoSections(p('Second'), section('continuous', 1440))).pages[0]!.fragments,
        'Second'
      ),
      marker: {
        text: '1.',
        style: {},
        box,
        level: 0,
        pieces: [
          { text: '.', style: {}, box: { ...box, width: 6 } },
          { text: '1', style: {}, box: { ...box, x: 16, width: 14 } },
        ],
      },
    } as unknown as ParagraphFragmentRecord;
    const [moved] = translateBlocksX([fragment], 72) as [ParagraphFragmentRecord];
    expect(moved.marker!.box.x).toBe(82);
    expect(moved.marker!.pieces!.map((piece) => piece.box.x)).toEqual([82, 88]);
    expect(translateBlocksX([fragment], 0)[0]).toBe(fragment);
  });
});

describe('anchored drawing in a continuous section on the shared sheet', () => {
  /** A 72pt square picture, `offsetPt` right of the `frame` origin. */
  const picture = (frame: string, offsetPt: number) =>
    `<w:p><w:pPr>${LINE}</w:pPr><w:r><w:drawing>` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${frame}"><wp:posOffset>${offsetPt * 12700}</wp:posOffset></wp:positionH>` +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="pic"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>' +
    '<w:r><w:t>Anchor</w:t></w:r></w:p>';
  function drawingX(frame: string, type: string, left: number, right = 1440, offset = 36): number {
    const document = twoSections(picture(frame, offset), section(type, left, right));
    const layout = layoutSemanticDocument(document, 0, {
      measurer,
      inlineDrawingLayout: layoutContext(document, '/word/document.xml'),
    });
    const page = layout.pages[layout.pages.length - 1]!;
    const drawing = page.anchoredDrawings![0]!;
    // Every box of the record is in one coordinate space, and the frame origin is `offset` back.
    expect(drawing.paintBounds.x).toBe(drawing.x);
    expect(drawing.hitBounds.x).toBe(drawing.x);
    expect(drawing.geometry.contentBounds.x).toBe(drawing.x);
    expect(drawing.horizontalFrameOrigin).toBe(drawing.x - offset);
    // From the sheet's left edge.
    return page.contentBox.x - page.box.x + drawing.x;
  }

  test('the page frame and the column frame resolve on the sheet and in the section', () => {
    expect(drawingX('page', 'continuous', 2880)).toBe(36);
    expect(drawingX('column', 'continuous', 2880)).toBe(144 + 36);
  });

  test('the margin frame is the margin of the shared sheet', () => {
    expect(drawingX('margin', 'continuous', 2880)).toBe(72 + 36);
    expect(drawingX('margin', 'continuous', 720)).toBe(72 + 36);
    expect(drawingX('margin', 'continuous', 2880, 2880)).toBe(72 + 36);
    expect(drawingX('column', 'continuous', 720)).toBe(36 + 36);
    // On its own sheet, the section's margin is the sheet's margin.
    expect(drawingX('margin', 'nextPage', 2880)).toBe(144 + 36);
  });
});
