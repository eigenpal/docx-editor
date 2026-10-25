// A floating table that leaves no passage beside it moves the earlier lines it covers on its page
// below it: a page- or margin-positioned one, and a text-anchored one raised above its anchor by
// a negative offset. The table keeps its place; the anchor follows the moved lines.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
/** A 60pt-tall table, `twips` wide; the default text column is 9360 twips. */
const table = (tblpPr: string, twips = 9360) =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="${twips}"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1200" ` +
  `w:hRule="exact"/></w:trPr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
const RAISED = '<w:tblpPr w:vertAnchor="text" w:tblpY="-600"/>';
const document = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const lay = (body: string) =>
  layoutSemanticDocument(document(body), 0, { measurer: createFixedMeasurer() });

/** Each block on the first page by its text (`T` for the table), with its top and bottom. */
function blocks(layout: SemanticLayout): Record<string, readonly [number, number]> {
  const out: Record<string, readonly [number, number]> = {};
  for (const fragment of layout.pages[0]!.fragments) {
    const name =
      fragment.kind === 'table'
        ? 'T'
        : fragment.lines.map((line) => line.spans.map((span) => span.text).join('')).join('');
    out[name] = [fragment.box.y, fragment.box.y + fragment.box.height];
  }
  return out;
}

test('a raised text table keeps its offset and moves the earlier lines it covers below it', () => {
  const plain = blocks(lay(p('A') + p('B') + p('C') + p('Head')));
  const raised = blocks(lay(p('A') + p('B') + p('C') + table(RAISED) + p('Head')));
  // The table starts 30pt above where its anchor started before anything moved.
  expect(raised.T![0]).toBeCloseTo(plain.Head![0] - 30, 0);
  // Every earlier line it covers, and the anchor after them, follow it in order.
  expect(raised.A![0]).toBeCloseTo(raised.T![1], 1);
  expect(raised.B![0]).toBeCloseTo(raised.A![1], 1);
  expect(raised.Head![0]).toBeCloseTo(raised.C![1], 1);
});

test('lines above the raised table stay', () => {
  const lines = ['A', 'B', 'C', 'D', 'E'].map(p).join('');
  const raised = blocks(lay(lines + table(RAISED) + p('Head')));
  // The table starts inside C, so C is the first line it moves.
  expect([raised.A![0], raised.B![0]]).toEqual([0, raised.A![1]]);
  expect(raised.C![0]).toBeCloseTo(raised.T![1], 1);
});

test('a page-positioned table moves the earlier lines it covers below it', () => {
  const placed = blocks(
    lay(p('A') + p('B') + table('<w:tblpPr w:vertAnchor="page" w:tblpY="1500"/>') + p('Head'))
  );
  expect(placed.A![0]).toBeCloseTo(placed.T![1], 1);
  expect(placed.Head![0]).toBeCloseTo(placed.B![1], 1);
});

test('a raised table with room for text beside it moves nothing', () => {
  const narrow = blocks(lay(p('A') + p('B') + p('C') + table(RAISED, 2880) + p('Head')));
  expect(narrow.A![0]).toBe(0);
  expect(narrow.C![1]).toBeCloseTo(narrow.Head![0], 1);
});

test('a warm pass after an edit above the table lays out like a cold one', () => {
  const session = createLayoutSession();
  const options = { measurer: createFixedMeasurer(), session };
  layoutSemanticDocument(document(p('A') + p('B') + table(RAISED) + p('Head')), 0, options);
  const edited = document(p('Z') + p('A') + p('B') + table(RAISED) + p('Head'));
  const warm = blocks(layoutSemanticDocument(edited, 1, options));
  const cold = blocks(layoutSemanticDocument(edited, 1, { measurer: createFixedMeasurer() }));
  expect(warm).toEqual(cold);
});
