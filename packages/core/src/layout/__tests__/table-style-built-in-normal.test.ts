// The table style named "Normal Table" keeps its built-in properties: no indent and 108 twips
// of left and right cell margin. Reference renderings ignore its authored margins, indent,
// alignment, and run properties, as the default style and when a table names it. The name
// decides, not the id: a default style with another name applies as written.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AUTHORED =
  '<w:tblPr><w:tblInd w:w="720" w:type="dxa"/><w:jc w:val="center"/><w:tblCellMar>' +
  '<w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  '<w:rPr><w:b/></w:rPr>';

function read(name: string, xml: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** The first cell of a table laid out under a default table style `id` named `name`. */
function firstCell(id: string, name: string, tableStyle = '') {
  const styles = read(
    '/word/styles.xml',
    `<w:styles xmlns:w="${W}"><w:style w:type="table" w:default="1" w:styleId="${id}">` +
      `<w:name w:val="${name}"/>${AUTHORED}</w:style></w:styles>`
  );
  const document = read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${tableStyle}` +
      '<w:tblW w:w="3000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>alpha</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:body></w:document>'
  );
  const layout = layoutSemanticDocument(document, 0, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: buildStyleCascadeTable(styles.root),
    compatibilityMode: 15,
    geometry: { width: 400, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const paragraph = table.rows[0]!.cells[0]!.blocks[0]!;
  if (paragraph.kind !== 'paragraph') throw new Error('expected a paragraph');
  const span = paragraph.lines[0]!.spans[0]!;
  return { tableX: table.box.x, textX: span.box.x, bold: span.style.bold };
}

test('the built-in "Normal Table" ignores its authored definition', () => {
  const normal = firstCell('TableNormal', 'Normal Table');
  const custom = firstCell('TableNormal', 'My default');
  // No indent and no centering: the table starts at the margin.
  expect(normal.tableX).toBe(0);
  // 108 twips of left margin, where the authored definition states none.
  expect(normal.textX - custom.textX + (custom.tableX - normal.tableX)).toBeCloseTo(5.4, 6);
  expect(normal.bold).toBe(false);
});

test('the name decides, not the id', () => {
  const byName = firstCell('MyDefault', 'Normal Table');
  expect(byName.tableX).toBe(0);
  expect(byName.bold).toBe(false);
  const byId = firstCell('TableNormal', 'My default');
  expect(byId.bold).toBe(true);
});

test('a table that names "Normal Table" also gets the built-in properties', () => {
  const named = firstCell('TableNormal', 'Normal Table', '<w:tblStyle w:val="TableNormal"/>');
  expect(named.tableX).toBe(0);
  expect(named.bold).toBe(false);
});
