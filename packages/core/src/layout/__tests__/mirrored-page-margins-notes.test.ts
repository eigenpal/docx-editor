// Mirrored side margins on the sheets the notes pass adds, and on the pages behind them.
//
// `w:mirrorMargins` (CT_OnOff, ECMA-376 Part 1 §17.15.1.57) puts a page on a side by its
// displayed number. A `sectEnd` endnote collection that does not fit adds sheets after the
// body pass. Each added sheet takes the side of its own number, and an odd count of them
// moves every later unrestarted page to the other side, with its header, footer and notes.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import type { PageFurniture } from '../page-furniture-insets.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);

const lines = (count: number, label: string) =>
  Array.from(
    { length: count },
    (_, i) => `<w:p><w:r><w:t>${label} ${i} ${'z'.repeat(40)}</w:t></w:r></w:p>`
  ).join('');

// Left 108pt, right 36pt: an even page has its content box 36pt from the sheet edge.
const GEOMETRY =
  '<w:pgSz w:w="12240" w:h="7200"/>' +
  '<w:pgMar w:top="1080" w:right="720" w:bottom="1080" w:left="2160" w:header="360" w:footer="360"/>';

// A floating table 20pt from the left edge of the sheet (`w:tblpPr`, CT_TblPPr, §17.4.57).
const PAGE_EDGE_TABLE =
  '<w:tbl><w:tblPr><w:tblpPr w:horzAnchor="page" w:vertAnchor="text" w:tblpX="400" w:tblpY="1"/>' +
  '<w:tblW w:w="1000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>' +
  '<w:p><w:r><w:t>T</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

// A picture 20pt from the left edge of the sheet (`wp:positionH`, ST_RelFromH, §20.4.3.4).
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PAGE_EDGE_PICTURE =
  '<w:p xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="${PIC}"><w:r><w:drawing>` +
  '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
  'allowOverlap="1" layoutInCell="1" relativeHeight="1"><wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="page"><wp:posOffset>254000</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="127000" cy="127000"/><wp:wrapNone/><wp:docPr id="1" name="picture"/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/>` +
  '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdNone"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="127000" cy="127000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';

const PICTURE_RESOURCE = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 10,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
} as const);

function documentWithEndnotes(endnoteLines: number, sectionTwoLead = ''): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>Section one body</w:t><w:endnoteReference w:id="1"/></w:r></w:p>' +
        `<w:p><w:pPr><w:sectPr>${GEOMETRY}<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr></w:sectPr></w:pPr></w:p>` +
        sectionTwoLead +
        lines(30, 'Section two body') +
        `<w:sectPr><w:type w:val="nextPage"/>${GEOMETRY}</w:sectPr>` +
        '</w:body></w:document>'
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes xmlns:w="${W}">` +
        '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
        '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
        `<w:endnote w:id="1">${lines(endnoteLines, 'Sect endnote')}</w:endnote>` +
        '</w:endnotes>'
    ),
  });
}

/** A header that prints `H` and the page number, so a stale projection shows. */
function numberedHeader(): PageFurniture {
  const part = readOoxmlPart(
    `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>H</w:t></w:r>` +
      '<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:hdr>',
    {
      name: '/word/header1.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    }
  );
  if (!part.ok) throw new Error(part.reason);
  const story = layoutHeaderFooterStory(part.part, 612 - 108 - 36, measurer, 'mirrored-notes');
  return {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map([['default', story]]),
    footers: new Map(),
  };
}

const headerText = (page: SemanticLayout['pages'][number]): string =>
  (page.header?.fragments ?? [])
    .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
    .flatMap((line) => line.spans.map((span) => span.text))
    .join('');

function layoutOf(bytes: Uint8Array, mirrorMargins: boolean, header = false): SemanticLayout {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const projections = indexInlineDrawingProjectionsInPart(part);
  const footnoteProps = resolveFootnoteProperties(undefined, undefined);
  const sectEnd = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
  const notes: NotesLayoutInput = {
    footnotesPart: null,
    endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
    footnotePropsBySection: [footnoteProps, footnoteProps],
    endnotePropsBySection: [sectEnd, sectEnd],
    documentFootnoteProps: footnoteProps,
    documentEndnoteProps: sectEnd,
    measurer,
    producer: 'mirrored-notes',
  };
  return layoutSemanticDocument(part, 1, {
    measurer,
    notes,
    producer: 'mirrored-notes',
    ...(mirrorMargins ? { pageMarginSettings: { mirrorMargins: true } } : {}),
    ...(header ? { sectionFurniture: [numberedHeader(), numberedHeader()] } : {}),
    inlineDrawingLayout: {
      ownerPartName: part.name,
      projectionForAtom: (atomId) => projections.get(atomId) ?? null,
      project: (node) =>
        projections.get(node.id) ??
        projectDrawing(node, {
          ownerPartName: part.name,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        }),
      resourceOf: () => PICTURE_RESOURCE,
    },
  });
}

/** A layout whose first section ends on `parity` overflow sheets (1 odd, 0 even, not none). */
function overflowLayout(
  parity: 0 | 1,
  mirrorMargins = true,
  header = false,
  sectionTwoLead = ''
): SemanticLayout {
  for (let endnoteLines = 6; endnoteLines < 80; endnoteLines += 3) {
    const layout = layoutOf(
      documentWithEndnotes(endnoteLines, sectionTwoLead),
      mirrorMargins,
      header
    );
    const sheets = layout.pages.filter((page) => page.noteStream === 'endnote-overflow').length;
    if (sheets > 0 && sheets % 2 === parity) return layout;
  }
  throw new Error('no endnote length gave the wanted number of overflow sheets');
}

const sideOf = (pageNumber: number) => (pageNumber % 2 === 0 ? 36 : 108);

describe('mirrored side margins after the notes pass', () => {
  for (const parity of [1, 0] as const) {
    test(`every page is on the side of its final number (${parity ? 'odd' : 'even'} sheet count)`, () => {
      const layout = overflowLayout(parity);
      expect(layout.pages.some((page) => page.noteStream === 'endnote-overflow')).toBe(true);
      layout.pages.forEach((page, index) => {
        expect(page.pageFieldSource?.pageNumber ?? index + 1).toBe(index + 1);
        expect(page.contentBox.x - page.box.x).toBe(sideOf(index + 1));
        expect(page.contentBox.width).toBe(612 - 108 - 36);
        // Note areas hold sheet coordinates: they sit on the content box they belong to.
        for (const area of [page.footnotes, page.endnotes]) {
          if (!area) continue;
          expect(area.box.x).toBe(page.contentBox.x);
          for (const note of area.notes) expect(note.box.x).toBe(page.contentBox.x);
        }
      });
    });
  }

  test('a moved page shows its header on its side, with its own page number', () => {
    const layout = overflowLayout(1, true, true);
    layout.pages.forEach((page, index) => {
      expect(page.header?.box.x).toBe(page.contentBox.x);
      expect(page.contentBox.x - page.box.x).toBe(sideOf(index + 1));
      expect(headerText(page)).toBe(`H${index + 1}`);
    });
  });

  test('a table positioned from the page edge keeps its place on a moved page', () => {
    // Sheet x of the table, of its cell, and of the first line in the cell.
    const tableOnSheet = (layout: SemanticLayout) => {
      for (const page of layout.pages) {
        const table = page.fragments.find((fragment) => fragment.kind === 'table');
        if (!table || table.kind !== 'table') continue;
        const cell = table.rows[0]!.cells[0]!;
        const paragraph = cell.blocks[0]!;
        if (paragraph.kind !== 'paragraph') throw new Error('no cell paragraph');
        const left = page.contentBox.x - page.box.x;
        return [table.box.x, cell.box.x, paragraph.lines[0]!.box.x].map((x) =>
          Number((left + x).toFixed(2))
        );
      }
      throw new Error('no table');
    };
    const unmoved = tableOnSheet(overflowLayout(0, true, false, PAGE_EDGE_TABLE));
    const moved = tableOnSheet(overflowLayout(1, true, false, PAGE_EDGE_TABLE));
    expect(unmoved[0]).toBeGreaterThan(15);
    expect(unmoved[0]).toBeLessThan(25);
    expect(moved).toEqual(unmoved);
    expect(tableOnSheet(overflowLayout(1, false, false, PAGE_EDGE_TABLE))).toEqual(unmoved);
  });

  test('a picture positioned from the page edge keeps its place on a moved page', () => {
    const pictureOnSheet = (layout: SemanticLayout) => {
      for (const page of layout.pages) {
        const picture = page.anchoredDrawings?.[0];
        if (!picture) continue;
        const left = page.contentBox.x - page.box.x;
        return [picture.x, picture.paintBounds.x, picture.hitBounds.x].map((x) =>
          Number((left + x).toFixed(2))
        );
      }
      throw new Error('no picture');
    };
    const unmoved = pictureOnSheet(overflowLayout(0, true, false, PAGE_EDGE_PICTURE));
    expect(unmoved[0]).toBe(20);
    expect(pictureOnSheet(overflowLayout(1, true, false, PAGE_EDGE_PICTURE))).toEqual(unmoved);
  });

  test('every part of a page-edge table that continues over pages keeps its place', () => {
    const row =
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>' +
      '<w:p><w:r><w:t>T</w:t></w:r></w:p></w:tc></w:tr>';
    const tall = PAGE_EDGE_TABLE.replace(/<w:tr>.*<\/w:tr>/, row.repeat(26));
    const partsOnSheet = (layout: SemanticLayout) =>
      layout.pages.flatMap((page) =>
        page.fragments
          .filter((fragment) => fragment.kind === 'table')
          .map((table) => Number((page.contentBox.x - page.box.x + table.box.x).toFixed(2)))
      );
    const unmoved = partsOnSheet(overflowLayout(0, true, false, tall));
    expect(unmoved.length).toBeGreaterThan(1);
    expect(new Set(unmoved).size).toBe(1);
    expect(partsOnSheet(overflowLayout(1, true, false, tall))).toEqual(unmoved);
  });

  test('a picture laid out in a cell of a table in the text flow stays in its cell', () => {
    const lead =
      '<w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${PAGE_EDGE_PICTURE}</w:tc></w:tr></w:tbl>`;
    // The distance from the cell's left edge to the picture.
    const inCell = (layout: SemanticLayout) => {
      for (const page of layout.pages) {
        const picture = page.anchoredDrawings?.[0];
        const table = page.fragments.find((fragment) => fragment.kind === 'table');
        if (picture && table) return Number((picture.x - table.box.x).toFixed(2));
      }
      throw new Error('no picture');
    };
    expect(inCell(overflowLayout(1, true, false, lead))).toBe(
      inCell(overflowLayout(0, true, false, lead))
    );
  });

  test('a text frame positioned from the page edge keeps its place on a moved page', () => {
    // `w:framePr/@w:hAnchor="page"` (CT_FramePr, §17.3.1.11), 20pt from the sheet edge.
    const frame =
      '<w:p><w:pPr><w:framePr w:w="1000" w:hAnchor="page" w:x="400" w:wrap="around"/></w:pPr>' +
      '<w:r><w:t>F</w:t></w:r></w:p>';
    const frameOnSheet = (layout: SemanticLayout) => {
      for (const page of layout.pages) {
        const left = page.contentBox.x - page.box.x;
        for (const fragment of page.fragments) {
          if (fragment.kind !== 'paragraph' || !fragment.positionedFrame) continue;
          return [fragment.box.x, fragment.positionedFrame.box.x, fragment.lines[0]!.box.x].map(
            (x) => Number((left + x).toFixed(2))
          );
        }
      }
      throw new Error('no frame');
    };
    const unmoved = frameOnSheet(overflowLayout(0, true, false, frame));
    expect(unmoved[1]).toBe(20);
    expect(frameOnSheet(overflowLayout(1, true, false, frame))).toEqual(unmoved);
    expect(frameOnSheet(overflowLayout(1, false, false, frame))).toEqual(unmoved);
  });

  test('without the setting no page moves', () => {
    const layout = overflowLayout(1, false);
    for (const page of layout.pages) expect(page.contentBox.x - page.box.x).toBe(108);
  });
});
