import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { PageRecord } from '../semantic-records.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
/** Page height; the note area is a 12pt separator plus one 12pt note line. */
const PAGE = 100;
const AREA_TOP = PAGE - 24;
const LINE = 12;

const run = (text: string) => `<w:r><w:rPr><w:sz w:val="22"/></w:rPr>${text}</w:r>`;
const p = (text: string, after = 0, height = LINE, keepNext = false) =>
  `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="0" w:after="${after * 20}" w:line="${height * 20}" w:lineRule="exact"/></w:pPr>${run(text)}</w:p>`;

function load(body: string) {
  const entries = {
    '[Content_Types].xml': `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="4000" w:h="${PAGE * 20}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${p('<w:separator/>')}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${p('<w:continuationSeparator/>')}</w:footnote><w:footnote w:id="1">${p('<w:t>Note</w:t>')}</w:footnote></w:footnotes>`,
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))
  );
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer(5, LINE);
  const options = (session = createLayoutSession()) => ({
    measurer,
    session,
    notes: {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      documentFootnoteProps: fn,
      footnotePropsBySection: [fn],
      documentEndnoteProps: en,
      endnotePropsBySection: [en],
      measurer,
      producer: 'footnote-space-after-fit-test',
    },
  });
  return { part, options };
}

function layout(body: string) {
  const { part, options } = load(body);
  return layoutSemanticDocument(part, 1, options());
}

const pageOf = (pages: readonly PageRecord[], text: string): number =>
  pages.findIndex((page) =>
    page.fragments.some(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((line) => line.spans.some((span) => span.text.includes(text)))
    )
  );

describe('space after above a footnote area', () => {
  // A spacer pushes the contested line so `room` points remain between its box and the area.
  const spacer = (room: number) => p('<w:t>Spacer</w:t>', 0, AREA_TOP - room - LINE);

  test('a citing line stays only when its space after fits too', () => {
    const cited = (room: number, after: number) =>
      layout(spacer(room) + p('<w:t>Cited</w:t><w:footnoteReference w:id="1"/>', after));
    expect(pageOf(cited(5, 10).pages, 'Cited')).toBe(1);
    expect(pageOf(cited(10, 10).pages, 'Cited')).toBe(0);
    expect(pageOf(cited(1, 0).pages, 'Cited')).toBe(0);
  });

  test('a plain closing line above the notes needs its space after', () => {
    const plain = (room: number, after: number) =>
      layout(
        p('<w:t>Opening</w:t><w:footnoteReference w:id="1"/>') +
          p('<w:t>Spacer</w:t>', 0, AREA_TOP - room - 2 * LINE) +
          p('<w:t>Closing</w:t>', after) +
          p('<w:t>Next</w:t>')
      );
    expect(pageOf(plain(5, 10).pages, 'Closing')).toBe(1);
    expect(pageOf(plain(12, 10).pages, 'Closing')).toBe(0);
  });

  test('a kept heading moves with a successor whose space after does not fit', () => {
    // Opening, spacer, heading and body leave `room` points above the note area.
    const kept = (room: number, cite = true) =>
      layout(
        p(`<w:t>Opening</w:t>${cite ? '<w:footnoteReference w:id="1"/>' : ''}`) +
          p('<w:t>Spacer</w:t>', 0, AREA_TOP - room - 3 * LINE) +
          p('<w:t>Heading</w:t>', 0, LINE, true) +
          p('<w:t>Body</w:t>', 10) +
          p('<w:t>Next</w:t>')
      ).pages;
    const moved = kept(5);
    expect(pageOf(moved, 'Heading')).toBe(1);
    expect(pageOf(moved, 'Body')).toBe(1);
    const stays = kept(12);
    expect(pageOf(stays, 'Heading')).toBe(0);
    expect(pageOf(stays, 'Body')).toBe(0);
    // Without a citation there is no note area, and the space after stays out of the fit.
    expect(pageOf(kept(5, false), 'Heading')).toBe(0);
  });

  test('a page without a citation keeps the space after out of the fit', () => {
    const pages = layout(
      p('<w:t>Spacer</w:t>', 0, PAGE - 2 * LINE) +
        p('<w:t>Closing</w:t>', 10) +
        p('<w:t>Next</w:t>')
    ).pages;
    expect(pageOf(pages, 'Closing')).toBe(0);
  });
});

test('a retained session matches a cold pass as a citing paragraph grows', () => {
  // The citing opening paragraph wraps as it grows and pushes the closing paragraph down
  // across its space-after threshold above the note area.
  const doc = load(
    p('<w:t xml:space="preserve">Opening </w:t><w:footnoteReference w:id="1"/>') +
      p('<w:t>Spacer</w:t>', 0, AREA_TOP - 20 - 2 * LINE) +
      p('<w:t>Closing</w:t>', 10) +
      p('<w:t>Next</w:t>')
  );
  let part = doc.part;
  const session = createLayoutSession();
  let result = layoutSemanticDocument(part, 1, doc.options(session));
  const opening = result.pages[0]!.fragments[0]!;
  if (opening.kind !== 'paragraph') throw new Error('expected a paragraph');
  for (let index = 0; index < 50; index++) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: opening.paragraphId,
      offset: index,
      text: 'w',
    });
    if (!edit.ok) throw new Error(edit.reason);
    part = edit.part;
    result = layoutSemanticDocument(part, 2 + index, doc.options(session));
    expect(result.pages).toEqual(layoutSemanticDocument(part, 2 + index, doc.options()).pages);
  }
  expect(pageOf(result.pages, 'Closing')).toBe(1);
});
