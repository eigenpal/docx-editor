import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { hitTestFragments, hitTestPage } from '../semantic-hit-test.ts';
import {
  caretAt,
  caretStopsForBlocks,
  documentOrder,
  selectionRects,
} from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { isBottomToTopCaret } from '../table-cell-text-direction.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function layout(bodyXml: string): SemanticLayout {
  return layoutSemanticDocument(loadPart(bodyXml), 0, { measurer: createFixedMeasurer() });
}

function firstTable(result: SemanticLayout): TableFragmentRecord {
  const table = result.pages[0]!.fragments[0];
  if (table?.kind !== 'table') throw new Error('expected table');
  return table;
}

describe('bottom-to-top table cell text', () => {
  test('lays text along the row height instead of the narrow column width', () => {
    const result = layout(
      '<w:tbl><w:tblGrid><w:gridCol w:w="510"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr>' +
        '<w:tc><w:tcPr><w:textDirection w:val="btLr"/><w:vAlign w:val="center"/></w:tcPr>' +
        paragraph('vertical label') +
        '</w:tc></w:tr></w:tbl>'
    );
    const cell = firstTable(result).rows[0]!.cells[0]!;
    const block = cell.blocks[0]!;
    if (block.kind !== 'paragraph') throw new Error('expected paragraph');
    expect(cell.textDirection).toBe('btLr');
    expect(cell.box).toMatchObject({ width: 25.5, height: 100 });
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]!.spans.map((span) => span.text).join('')).toBe('vertical label');

    const span = block.lines[0]!.spans[0]!;
    const paintedPoint = {
      x: cell.box.x + (span.box.y - cell.box.y) + span.box.height / 2,
      y: cell.box.y + cell.box.height - (span.box.x - cell.box.x) - span.box.width / 2,
    };
    const hit = hitTestPage(result, 0, paintedPoint)!;
    expect(hit.position.paragraphId).toBe(block.paragraphId);
    expect(isBottomToTopCaret(hit.caret)).toBe(true);
    const caret = caretAt(result, { paragraphId: block.paragraphId, offset: 0 })!;
    expect(isBottomToTopCaret(caret)).toBe(true);
    expect(hit.caret).toEqual(caretAt(result, hit.position, { preferredPageIndex: 0 }));
    expect(hit.caret.x).toBeGreaterThanOrEqual(cell.box.x);
    expect(hit.caret.x).toBeLessThanOrEqual(cell.box.x + cell.box.width);
    expect(caret.x).toBeGreaterThanOrEqual(cell.box.x);
    expect(caret.x).toBeLessThanOrEqual(cell.box.x + cell.box.width);
    const selection = {
      anchor: { paragraphId: block.paragraphId, offset: 0 },
      head: { paragraphId: block.paragraphId, offset: 'vertical label'.length },
    };
    const [rect] = selectionRects(result, selection, documentOrder(result));
    expect(rect!.width).toBeCloseTo(block.lines[0]!.box.height, 3);
    expect(rect!.height).toBeGreaterThan(rect!.width);
  });

  test('keeps caret geometry available in furniture and note stories', () => {
    const bodyLayout = layout(
      '<w:tbl><w:tblGrid><w:gridCol w:w="510"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr>' +
        '<w:tc><w:tcPr><w:textDirection w:val="btLr"/></w:tcPr>' +
        paragraph('story label') +
        '</w:tc></w:tr></w:tbl>'
    );
    const page = bodyLayout.pages[0]!;
    const fragments = page.fragments;
    const storyLayouts: SemanticLayout[] = [
      {
        ...bodyLayout,
        pages: [
          {
            ...page,
            fragments: [],
            header: {
              kind: 'header',
              variant: 'default',
              partName: '/word/header1.xml',
              box: page.contentBox,
              fragments,
            },
          },
        ],
      },
      {
        ...bodyLayout,
        pages: [
          {
            ...page,
            fragments: [],
            footnotes: {
              kind: 'footnotes',
              placement: 'pageBottom',
              box: page.contentBox,
              notes: [
                {
                  noteKind: 'footnote',
                  noteId: 1,
                  scopeId: 'footnote:1',
                  mark: '1',
                  box: page.contentBox,
                  fragments,
                },
              ],
            },
          },
        ],
      },
    ];
    const cell = firstTable(bodyLayout).rows[0]!.cells[0]!;
    const point = { x: cell.box.x + cell.box.width / 2, y: cell.box.y + cell.box.height / 2 };
    for (const storyLayout of storyLayouts) {
      const hit = hitTestFragments(storyLayout, 0, fragments, point)!;
      expect(isBottomToTopCaret(hit.caret)).toBe(true);
      const stops = caretStopsForBlocks(storyLayout, 0, fragments);
      expect(stops.length).toBeGreaterThan(1);
      expect(stops.every(isBottomToTopCaret)).toBe(true);
    }
  });
});
