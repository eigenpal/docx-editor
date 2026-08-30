import { expect, test } from 'bun:test';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
  TableFragmentRecord,
} from '../../layout/semantic-records.ts';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';

function span(paragraphId: string, text: string, projected = false): StyleSpanRecord {
  return {
    range: { paragraphId, start: 0, end: text.length },
    text,
    style: {},
    ...(projected ? { projected: true } : {}),
  } as unknown as StyleSpanRecord;
}

function paragraph(
  paragraphId: string,
  spans: readonly StyleSpanRecord[],
  lineParagraphId = paragraphId
): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    paragraphId,
    lines: [
      {
        range: { paragraphId: lineParagraphId, start: 0, end: 1 },
        spans,
        drawings: [],
      },
    ],
  } as unknown as ParagraphFragmentRecord;
}

test('traverses canonical story segments and exposes authored identities through repeats', () => {
  const merged = paragraph(
    'survivor',
    [span('absorbed', 'A'), span('survivor', 'B', true)],
    'absorbed'
  );
  const headerParagraph = paragraph('header-p', [span('header-p', 'H')]);
  const table = (fragmentIndex: number, repeat: boolean): TableFragmentRecord =>
    ({
      kind: 'table',
      tableId: 'table',
      fragmentIndex,
      rows: [
        {
          id: 'header-row',
          isHeaderRow: true,
          isHeaderRepeat: repeat,
          cells: [{ gridColumn: 0, gridSpan: 1, blocks: [headerParagraph] }],
        },
      ],
    }) as unknown as TableFragmentRecord;
  const layout = {
    pages: [
      { index: 0, fragments: [merged, table(0, false)] },
      { index: 1, fragments: [table(1, true)] },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<{ paragraphId: string; projected: boolean; sourceRange: unknown }> = [];

  forEachSemanticSpan(layout, ({ paragraphId, span: current, sourceRange }) => {
    visits.push({ paragraphId, projected: current.projected === true, sourceRange });
  });

  expect(visits.map((visit) => visit.paragraphId)).toEqual([
    'absorbed',
    'survivor',
    'header-p',
    'header-p',
  ]);
  expect(visits[0]?.sourceRange).toEqual({ paragraphId: 'absorbed', start: 0, end: 1 });
  expect(visits[1]).toMatchObject({ paragraphId: 'survivor', projected: true, sourceRange: null });
});
