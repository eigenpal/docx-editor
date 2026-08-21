// A note story stays reachable whatever it holds.
//
// Found while building the parity fixture: giving every story an identical probe story made the
// footnote and endnote disappear. `validKnownKind` spelled out the note's child rule instead of
// reusing the body's, and the copy admitted only `generic` where the body admits every preserved
// child. So a block `w:sdt` — or a bookmark, a hyperlink, a range marker — demoted the NOTE, and
// a demoted note is not a note: it leaves `notesOf`, its paragraphs leave `paragraphIdsIn`, and
// `enterNote` refuses with no reason, because nothing believes a note is there to enter.
//
// All of those are ordinary Word markup inside a footnote, so this was a note that could not be
// read or edited at all. Each is pinned below, because the rule they share is one predicate and
// a future edit to it would take them all together.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const BLOCK_SDT =
  `<w:sdt><w:sdtPr><w:alias w:val="Pick"/><w:tag w:val="Pick"/><w:text/></w:sdtPr>` +
  `<w:sdtContent><w:p><w:r><w:t>Control</w:t></w:r></w:p></w:sdtContent></w:sdt>`;

const NOTE_PARAGRAPH = '<w:p><w:r><w:t>Note</w:t></w:r></w:p>';

/** One footnote holding exactly `inner`, referenced from the body. */
function docx(inner: string): Uint8Array {
  const body =
    `<w:p><w:r><w:t>Alpha</w:t></w:r>` +
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="1"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0">` +
    `<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1">${inner}</w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

function mount(inner: string): { surface: PaginatedSurface; destroy: () => void } {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, docx(inner), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return {
    surface: result.surface,
    destroy: () => {
      result.surface.destroy();
      container.remove();
    },
  };
}

/** Paragraphs the footnote part publishes, minus the two separator paragraphs. */
function noteParagraphCount(surface: PaginatedSurface): number {
  const ids = surface.session.paragraphIdsIn({ kind: 'notesPart', noteKind: 'footnote' });
  return Math.max(0, ids.length - 2);
}

const BOOKMARK = '<w:bookmarkStart w:id="1" w:name="mark"/><w:bookmarkEnd w:id="1"/>';

describe('a note story is reachable whatever it holds', () => {
  for (const [what, inner, paragraphs] of [
    ['paragraphs', NOTE_PARAGRAPH, 1],
    ['a block content control', `${NOTE_PARAGRAPH}${BLOCK_SDT}`, 2],
    ['a bookmark', `${BOOKMARK}${NOTE_PARAGRAPH}`, 1],
  ] as const) {
    test(`a footnote holding ${what} is reachable`, () => {
      const { surface, destroy } = mount(inner);
      try {
        expect(noteParagraphCount(surface)).toBe(paragraphs);
        expect(surface.enterNote('footnote:1')).toBe(true);
      } finally {
        destroy();
      }
    });
  }
});
