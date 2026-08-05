// `w:tblpPr` (17.4.57): a table positioned against an anchor box rather than at the point
// in the text where it was authored.
//
// Word's floating table is also pulled out of the flow so text wraps beside it. That part
// is not modelled — the table keeps its place in the flow and only its position within the
// line of the page moves. A centred callout table therefore lands where Word draws it,
// while the paragraphs around it still clear it top-to-bottom.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { readTableStructure, tableFloatOriginX } from '../semantic-table.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const documentOf = (bodyXml: string) =>
  part(`<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`);

function tableNode(bodyXml: string): OoxmlElement {
  const found = documentOf(bodyXml)
    .root.children.flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  if (!found) throw new Error('no table');
  return found as OoxmlElement;
}

/** Letter portrait with 1" margins, the default `layoutSemanticDocument` geometry. */
const CONTENT_WIDTH_PT = 468;
const FRAMES = {
  text: { left: 0, width: CONTENT_WIDTH_PT },
  margin: { left: 0, width: CONTENT_WIDTH_PT },
  page: { left: -72, width: 612 },
} as const;

const cell = () => `<w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`;
/** 144pt wide, leaving 324pt of slack in the text column. */
const narrow = `<w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${cell()}${cell()}</w:tr>`;
const TABLE_WIDTH_PT = 144;

const structureOf = (bodyXml: string, depth = 0) =>
  readTableStructure(tableNode(bodyXml), CONTENT_WIDTH_PT, depth)!;

const floatingTable = (tblpPr: string) =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:type="dxa" w:w="2880"/></w:tblPr>${narrow}</w:tbl>`;

function firstTable(bodyXml: string): TableFragmentRecord {
  const fragment = layoutSemanticDocument(documentOf(bodyXml), 0, {
    measurer: createFixedMeasurer(),
  })
    .pages.flatMap((page) => page.fragments)
    .find((item): item is TableFragmentRecord => item.kind === 'table');
  if (!fragment) throw new Error('no table fragment');
  return fragment;
}

describe('w:tblpPr is read off the table', () => {
  test('an absent w:tblpPr leaves the table unfloated', () => {
    expect(structureOf(floatingTable('')).float).toBeUndefined();
  });

  test('anchors default to text and offsets convert to points', () => {
    const float = structureOf(floatingTable('<w:tblpPr w:tblpX="720" w:tblpY="200"/>')).float;
    expect(float).toEqual({ horzAnchor: 'text', vertAnchor: 'text', xPt: 36, yPt: 10 });
  });

  test('a negative offset survives — Word pulls a table into the margin with one', () => {
    const float = structureOf(floatingTable('<w:tblpPr w:tblpX="-720"/>')).float;
    expect(float?.xPt).toBe(-36);
  });

  test('an unrecognised spec is dropped, leaving the offset to place the table', () => {
    const float = structureOf(
      floatingTable('<w:tblpPr w:tblpXSpec="sideways" w:tblpX="720"/>')
    ).float;
    expect(float?.xSpec).toBeUndefined();
    expect(float?.xPt).toBe(36);
  });

  test('a nested table stays in flow — Word floats only the top-level one', () => {
    expect(structureOf(floatingTable('<w:tblpPr w:tblpXSpec="center"/>'), 1).float).toBeUndefined();
  });
});

describe('tableFloatOriginX places the table against its anchor', () => {
  const originOf = (tblpPr: string) => {
    const structure = structureOf(floatingTable(tblpPr));
    return tableFloatOriginX(structure.float!, TABLE_WIDTH_PT, FRAMES);
  };

  test('tblpXSpec="center" centres the table in the anchor box', () => {
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="center"/>')).toBe(162);
  });

  test('tblpXSpec="right" puts the trailing edge on the anchor box edge', () => {
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="right"/>')).toBe(324);
  });

  test('a spec supersedes tblpX (17.4.57)', () => {
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="center" w:tblpX="2880"/>')).toBe(
      162
    );
  });

  test('inside/outside render as left/right without mirrored margins', () => {
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="inside"/>')).toBe(0);
    expect(originOf('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="outside"/>')).toBe(324);
  });

  test('the page anchor measures from the sheet edge, not the margin', () => {
    // 1" from the sheet edge is 1" left of the text column, whose x is 0.
    expect(originOf('<w:tblpPr w:horzAnchor="page" w:tblpX="1440"/>')).toBe(0);
    expect(originOf('<w:tblpPr w:horzAnchor="page" w:tblpXSpec="left"/>')).toBe(-72);
  });

  test('a hostile offset keeps the leading edge on the sheet', () => {
    expect(originOf('<w:tblpPr w:tblpX="999999999"/>')).toBe(540);
    expect(originOf('<w:tblpPr w:tblpX="-999999999"/>')).toBe(-72);
  });
});

describe('a floated table lays out at its anchored position', () => {
  const paragraph = '<w:p><w:r><w:t>lead</w:t></w:r></w:p>';

  test('the fragment box and every row share the floated origin', () => {
    const fragment = firstTable(
      paragraph + floatingTable('<w:tblpPr w:horzAnchor="margin" w:tblpXSpec="center"/>')
    );
    expect(fragment.box.x).toBeCloseTo(162, 3);
    for (const row of fragment.rows) expect(row.box.x).toBeCloseTo(162, 3);
    expect(fragment.rows[0]!.cells[0]!.box.x).toBeCloseTo(162, 3);
  });

  test('an unfloated table is unaffected', () => {
    const fragment = firstTable(paragraph + floatingTable(''));
    expect(fragment.box.x).toBeCloseTo(0, 3);
  });

  test('tblpY against the text anchor moves the table down the flow', () => {
    const inFlow = firstTable(paragraph + floatingTable('')).box.y;
    const floated = firstTable(paragraph + floatingTable('<w:tblpPr w:tblpY="200"/>')).box.y;
    expect(floated - inFlow).toBeCloseTo(10, 3);
  });

  test('the comprehensive fixture §16 callout table centres on the margin', () => {
    const bytes = readFileSync(
      `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`
    );
    const opened = readOoxmlPackage(bytes);
    if (!opened.ok) throw new Error(opened.reason);
    const main = opened.package.parts.get(opened.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(main, 0, { measurer: createFixedMeasurer() });
    const table = layout.pages
      .flatMap((page) => page.fragments)
      .find(
        (fragment): fragment is TableFragmentRecord =>
          fragment.kind === 'table' &&
          fragment.rows.some((row) =>
            row.cells.some((cellRecord) =>
              cellRecord.blocks.some(
                (block) =>
                  block.kind === 'paragraph' &&
                  block.lines.some((line) =>
                    line.spans.some((span) => span.text.includes('Uptime'))
                  )
              )
            )
          )
      );
    if (!table) throw new Error('§16 floating table not found');
    // `tblpXSpec="center"` with `horzAnchor="margin"` — the table sits centred in the text
    // area, not flush left where an unfloated table lands.
    expect(table.box.x).toBeCloseTo((CONTENT_WIDTH_PT - table.box.width) / 2, 3);
    expect(table.box.x).toBeGreaterThan(1);
  });

  test('a page-anchored tblpY is not applied — the table stays in flow', () => {
    const inFlow = firstTable(paragraph + floatingTable('')).box.y;
    const floated = firstTable(
      paragraph + floatingTable('<w:tblpPr w:vertAnchor="page" w:tblpY="2880"/>')
    ).box.y;
    expect(floated).toBeCloseTo(inFlow, 3);
  });
});
