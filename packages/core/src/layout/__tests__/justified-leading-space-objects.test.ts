// Leading spaces of a justified line (`w:jc w:val="both"`, CT_Jc, ECMA-376 §17.3.1.13) keep
// their advance only when they start the stretched text. These cases sit around that rule:
// a space after an inline picture, a list number before the spaces, and a table cell line
// that an ignored page break ends after a center stop (ST_TabJc, §17.18.84).
import { expect, test } from 'bun:test';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${DML}" xmlns:pic="${PIC}" xmlns:r="${REL}"`;

// 10pt per character at 11pt and a 300pt measure.
const measurer = createFixedMeasurer(10, 14);
const geometry = { width: 320, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const TAIL = 'ef gh ij kl mn op stuvwxyzabcdefgh end';
const RPR = '<w:rPr><w:sz w:val="22"/></w:rPr>';
const run = (text: string) => `<w:r>${RPR}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const TAB = '<w:r><w:tab/></w:r>';
const paragraph = (content: string, jc: string, properties = '') =>
  `<w:p><w:pPr>${properties}<w:jc w:val="${jc}"/></w:pPr>${content}</w:p>`;

/** A 12pt wide inline picture. */
const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="152400" cy="127000"/><wp:docPr id="1" name="p"/><wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/>` +
  '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="example"/></pic:blipFill><pic:spPr>' +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="152400" cy="127000"/></a:xfrm><a:prstGeom prst="rect">' +
  '<a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
const resource = Object.freeze({
  kind: 'ready' as const,
  partName: '/word/media/example.png',
  contentId: 'example',
  resourceKey: 'example',
  mime: 'image/png',
  pixelWidth: 12,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});

function part(name: string, xml: string): OoxmlPart {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const numberingIndex = buildNumberingIndex(
  part(
    '/word/numbering.xml',
    `<w:numbering ${NS}><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
      '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>'
  ).root
);

function firstLine(body: string): LineRecord {
  const doc = part('/word/document.xml', `<w:document ${NS}><w:body>${body}</w:body></w:document>`);
  const projections = indexInlineDrawingProjectionsInPart(doc);
  const inlineDrawingLayout: InlineDrawingLayoutContext = {
    ownerPartName: doc.name,
    projectionForAtom: (id) => projections.get(id) ?? null,
    project: (node) => projections.get(node.id) ?? null,
    resourceOf: () => resource,
  };
  const layout = layoutSemanticDocument(doc, 0, {
    measurer,
    geometry,
    numberingIndex,
    inlineDrawingLayout,
    compatibilityMode: 15,
  });
  return linesOf(layout)[0] as LineRecord;
}
const x = (line: LineRecord, word: string) =>
  line.spans.find((span) => span.text.trim() === word)!.box.x;

test('a space after an inline picture at the line start stretches', () => {
  const body = (jc: string) => paragraph(picture + run(` ab ${TAIL}`), jc);
  const line = firstLine(body('both'));
  const natural = firstLine(body('left'));
  expect(line.drawings).toHaveLength(1);
  // The space starts after the picture, so it is a space between two things on the line.
  expect(line.spans[0]!.text).toBe(' ');
  expect(line.spans[0]!.box.x).toBe(natural.spans[0]!.box.x);
  expect(line.spans[0]!.box.x).toBeGreaterThan(0);
  expect(x(line, 'ab')).toBeGreaterThan(x(natural, 'ab'));
});

test('spaces at the line start keep their advance before a picture', () => {
  const body = (jc: string) => paragraph(run('  ') + picture + run(` ab ${TAIL}`), jc);
  const line = firstLine(body('both'));
  const natural = firstLine(body('left'));
  // The two spaces before the picture are leading spaces; the one after it stretches.
  expect(line.spans.slice(0, 2).map((span) => span.box.x)).toEqual([0, 10]);
  expect(x(line, 'ab')).toBeGreaterThan(x(natural, 'ab'));
});

test('leading spaces after a list number keep their advance', () => {
  const numbered = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
  // The text starts at 72pt; the long word leaves the first line with room to spare.
  const body = (jc: string) =>
    paragraph(run('   ab ef gh ij kl stuvwxyzabcdefgh end'), jc, numbered);
  const line = firstLine(body('both'));
  const natural = firstLine(body('left'));
  expect(x(line, 'ab')).toBe(x(natural, 'ab'));
  expect(x(line, 'gh') - x(line, 'ef')).toBeGreaterThan(x(natural, 'gh') - x(natural, 'ef'));
});

test('a cell line that an ignored page break ends stretches after a center stop', () => {
  // A table cell ignores the page break, so no break closes the line: it wraps at the long
  // word, the stop does not hold the text, and the text after the tab stretches to the edge.
  const stop = '<w:tabs><w:tab w:val="center" w:pos="3000"/></w:tabs>';
  const content =
    run('ab') + TAB + run('cd ef') + '<w:r><w:br w:type="page"/></w:r>' + run(` ${'x'.repeat(26)}`);
  const cell = (jc: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
    `<w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${paragraph(content, jc, stop)}` +
    '</w:tc></w:tr></w:tbl><w:p/>';
  const line = firstLine(cell('both'));
  const natural = firstLine(cell('left'));
  expect(x(line, 'cd')).toBe(x(natural, 'cd'));
  expect(x(line, 'ef')).toBeGreaterThan(x(natural, 'ef'));
});
