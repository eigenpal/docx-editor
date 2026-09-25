import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { isOutOfFlowTableFragment } from '../table-float-position.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>${props}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/** A lead paragraph whose one exact line fills `height` points of the page. */
const lead = (height: number) =>
  p('Lead', `<w:spacing w:line="${height * 20}" w:lineRule="exact"/>`);
const row = (index: number, header = false) =>
  `<w:tr><w:trPr>${header ? '<w:tblHeader/>' : ''}<w:trHeight w:val="800" w:hRule="exact"/></w:trPr><w:tc>${p(`Row ${index}`)}</w:tc></w:tr>`;
/** A text-relative floating table of 40 pt rows. Offsets and widths are in points. */
const table = ({
  width = 200,
  offset = 0,
  rows = 4,
  header = false,
  anchor = 'w:horzAnchor="text" w:tblpX="1"',
  extra = '',
} = {}) =>
  `<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="text" ${anchor} w:tblpY="${offset * 20 + (offset < 0 ? -1 : 1)}"/>${extra}<w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="${width * 20}"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:bottom w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${width * 20}"/></w:tblGrid>${Array.from(
    { length: rows },
    (_, index) => row(index, header && index === 0)
  ).join('')}</w:tbl>`;
const part = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const options = {
  measurer: createFixedMeasurer(6, 12),
  geometry: { width: 200, height: 200, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
};
type Layout = ReturnType<typeof layoutSemanticDocument>;
const render = (body: string): Layout => layoutSemanticDocument(part(body), 0, options);
const tablesOn = (layout: Layout, page: number) =>
  layout.pages[page]!.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table');
const paragraphsOn = (layout: Layout, page: number) =>
  layout.pages[page]!.fragments.filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph');
const rowText = (fragment: TableFragmentRecord) =>
  fragment.rows.map((placed) =>
    placed.cells[0]!.blocks.flatMap((block) =>
      block.kind === 'paragraph'
        ? block.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    ).join('')
  );

describe('a text-relative table that spans its column and misses the page bottom', () => {
  for (const [label, shape] of [
    ['text anchored', {}],
    ['margin anchored and wider than the column', { width: 210, anchor: 'w:horzAnchor="margin"' }],
    ['right to left', { extra: '<w:bidiVisual/>' }],
  ] as const) {
    test(`breaks between rows and continues at the next page top (${label})`, () => {
      const layout = render(lead(100) + table(shape) + p('Anchor') + p('Tail'));
      expect(layout.pages).toHaveLength(2);
      const [first] = tablesOn(layout, 0);
      const [rest] = tablesOn(layout, 1);
      expect(isOutOfFlowTableFragment(first!)).toBe(false);
      expect(isOutOfFlowTableFragment(rest!)).toBe(false);
      expect(first!.box.y).toBe(100);
      expect(rowText(first!)).toEqual(['Row 0', 'Row 1']);
      expect(first!.box.y + first!.box.height).toBeLessThanOrEqual(200);
      expect(rest!.box.y).toBe(0);
      expect(rowText(rest!)).toEqual(['Row 2', 'Row 3']);
      // No text can stand beside the table, so the anchor follows its last row.
      const [anchor, tail] = paragraphsOn(layout, 1);
      expect(anchor!.lines[0]!.spans[0]!.text).toBe('Anchor');
      expect(anchor!.lines[0]!.box.y).toBe(80);
      expect(tail!.lines[0]!.box.y).toBe(92);
    });
  }

  test('keeps the offset above the first row', () => {
    const layout = render(lead(60) + table({ offset: 20 }) + p('Anchor'));
    const [first] = tablesOn(layout, 0);
    expect(first!.box.y).toBe(80);
    expect(rowText(first!)).toEqual(['Row 0', 'Row 1', 'Row 2']);
    expect(rowText(tablesOn(layout, 1)[0]!)).toEqual(['Row 3']);
  });

  test('repeats a header row on the continuation page', () => {
    const layout = render(lead(100) + table({ header: true }) + p('Anchor'));
    expect(rowText(tablesOn(layout, 0)[0]!)).toEqual(['Row 0', 'Row 1']);
    const rest = tablesOn(layout, 1)[0]!;
    expect(rowText(rest)).toEqual(['Row 0', 'Row 2', 'Row 3']);
    expect(rest.rows[0]!.isHeaderRepeat).toBe(true);
  });

  test('lays out the same through a retained session when an edit moves the page bottom', () => {
    const initial = part(lead(20) + table() + p('Anchor') + p('Tail'));
    const bodyOf = (source: ReturnType<typeof part>) => {
      const body = source.root.children.find(
        (node) => node.kind !== 'textValue' && node.localName === 'body'
      );
      if (!body || body.kind === 'textValue') throw new Error('body');
      return body;
    };
    const body = bodyOf(initial);
    const taller = bodyOf(part(lead(100)));
    // Only the lead changes; the table and its anchor keep their node identities.
    const edited = {
      ...initial,
      root: {
        ...initial.root,
        children: initial.root.children.map((node) =>
          node === body
            ? {
                ...body,
                children: body.children.map((child, index) =>
                  index === 0 ? taller.children[0]! : child
                ),
              }
            : node
        ),
      },
    };
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    for (const [revision, source] of [initial, edited, initial, edited].entries()) {
      const warm = layoutSemanticDocument(source, revision, { ...options, session, cache });
      expect(warm.pages).toEqual(layoutSemanticDocument(source, revision, options).pages);
      const fragments = warm.pages.flatMap((_, page) => tablesOn(warm, page));
      expect(fragments.map(isOutOfFlowTableFragment)).toEqual(
        source === edited ? [false, false] : [true]
      );
    }
  });
});

describe('floating tables that still move whole with their anchor', () => {
  const movesWhole = (layout: Layout, rows: number) => {
    expect(layout.pages).toHaveLength(2);
    expect(tablesOn(layout, 0)).toHaveLength(0);
    const [floating] = tablesOn(layout, 1);
    expect(isOutOfFlowTableFragment(floating!)).toBe(true);
    expect(floating!.rows).toHaveLength(rows);
  };

  test('a table narrower than its column keeps text beside it', () => {
    const layout = render(lead(100) + table({ width: 80 }) + p('Anchor'));
    movesWhole(layout, 4);
    const anchor = paragraphsOn(layout, 1)[0]!;
    expect(anchor.lines[0]!.spans[0]!.box.x).toBeGreaterThanOrEqual(80);
  });

  test('a first row that does not fit the room left', () => {
    movesWhole(render(lead(170) + table() + p('Anchor')), 4);
  });

  test('a header row that fits without the first body row', () => {
    movesWhole(render(lead(130) + table({ header: true }) + p('Anchor')), 4);
  });

  test('a negative offset that lays the table over earlier text', () => {
    movesWhole(render(lead(100) + table({ offset: -6 }) + p('Anchor')), 4);
  });
});

test('a spanning table that fits the room left stays whole on its anchor page', () => {
  const layout = render(lead(20) + table() + p('Anchor'));
  expect(layout.pages).toHaveLength(1);
  const [floating] = tablesOn(layout, 0);
  expect(isOutOfFlowTableFragment(floating!)).toBe(true);
  expect(floating!.rows).toHaveLength(4);
  expect(floating!.box.y).toBe(20);
});
