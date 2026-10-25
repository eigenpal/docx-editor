// A page- or margin-positioned table near the page bottom can cycle: on the anchor's page it
// covers the anchor, which moves on and takes the table along, which frees the anchor again.
// An edited layout enters that cycle from the previous pages, so it must settle like a fresh one.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, i) => p(`${prefix}${i}`)).join('');
const table = (tblpPr: string) =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="9360"/></w:tblPr>` +
  '<w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr>' +
  '<w:trHeight w:val="1200" w:hRule="exact"/></w:trPr><w:tc><w:p><w:r><w:t>cell</w:t></w:r>' +
  '</w:p></w:tc></w:tr></w:tbl>';
const document = (body: string) => {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
};
const placed = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page, index) =>
    page.fragments.map((fragment) => {
      const text =
        fragment.kind === 'table'
          ? 'T'
          : fragment.lines.map((line) => line.spans.map((span) => span.text).join('')).join('|');
      return `${index}:${text}@${fragment.box.y.toFixed(1)}`;
    })
  );
/** Text lines on the table's page that overlap it. */
const covered = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) => {
    const tables = page.fragments.filter((fragment) => fragment.kind === 'table');
    return page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines
            .filter((line) =>
              tables.some(
                (t) =>
                  line.box.y < t.box.y + t.box.height - 0.5 &&
                  line.box.y + line.box.height > t.box.y + 0.5
              )
            )
            .map((line) => line.spans.map((span) => span.text).join(''))
        : []
    );
  });

const long = `Head ${'word '.repeat(40)}`;
for (const [name, tblpPr, head, count] of [
  ['page', '<w:tblpPr w:vertAnchor="page" w:tblpY="13000"/>', 'Head', 42],
  ['margin', '<w:tblpPr w:vertAnchor="margin" w:tblpY="9000"/>', long, 40],
] as const) {
  test(`an edit that moves the anchor of a ${name}-positioned table lays out like a fresh layout`, () => {
    const body = (before: string) => before + table(tblpPr) + p(head) + p('After') + lines(3, 'Z');
    const session = createLayoutSession();
    const options = { measurer: createFixedMeasurer(), session };
    layoutSemanticDocument(document(body(lines(count, 'L'))), 0, options);
    const edited = document(body(lines(3, 'X') + lines(count, 'L')));
    const warm = layoutSemanticDocument(edited, 1, options);
    const cold = layoutSemanticDocument(edited, 1, { measurer: createFixedMeasurer() });
    expect(placed(warm)).toEqual(placed(cold));
    expect(covered(warm)).toEqual([]);
  });
}
