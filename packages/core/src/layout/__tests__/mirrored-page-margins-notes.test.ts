// Mirrored side margins on the sheets the notes pass adds, and on the pages behind them.
//
// `w:mirrorMargins` (CT_OnOff, ECMA-376 Part 1 §17.15.1.57) puts a page on a side by its
// displayed number. A `sectEnd` endnote collection that does not fit adds sheets after the
// body pass. Each added sheet takes the side of its own number, and an odd count of them
// moves every later unrestarted page to the other side, with its header, footer and notes.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
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

function documentWithEndnotes(endnoteLines: number): Uint8Array {
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

function layoutOf(bytes: Uint8Array, mirrorMargins: boolean): SemanticLayout {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
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
  });
}

/** A layout whose first section ends on `parity` overflow sheets (1 odd, 0 even, not none). */
function overflowLayout(parity: 0 | 1, mirrorMargins = true): SemanticLayout {
  for (let endnoteLines = 6; endnoteLines < 80; endnoteLines += 3) {
    const layout = layoutOf(documentWithEndnotes(endnoteLines), mirrorMargins);
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

  test('without the setting no page moves', () => {
    const layout = overflowLayout(1, false);
    for (const page of layout.pages) expect(page.contentBox.x - page.box.x).toBe(108);
  });
});
