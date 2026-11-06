// The list buttons start a list on a definition of their own. A heading numbering ("01",
// "01.1", large and colored, linked to Heading 1 and Heading 2) is decimal too, but a plain
// paragraph never borrows it, nor any other definition the document authored. Reference
// renderings create a new "1." / "a." / "i." definition even when an unused plain one exists.
// A paragraph next to the heading numbering joins that list the way the reference does: it
// takes the heading style the level is linked to.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** numId 1: the heading numbering. numId 2: a plain decimal list no paragraph uses. */
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  '<w:multiLevelType w:val="multilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading1"/>' +
  '<w:lvlText w:val="0%1"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>' +
  '<w:rPr><w:color w:val="5078FF"/><w:sz w:val="40"/></w:rPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading2"/>' +
  '<w:lvlText w:val="0%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>' +
  '</w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num></w:numbering>';

const heading = (id: string, level: number) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="heading ${level + 1}"/>` +
  `<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/>` +
  `</w:numPr><w:outlineLvl w:val="${level}"/></w:pPr></w:style>`;

const STYLES =
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/></w:style>${heading('Heading1', 0)}${heading('Heading2', 1)}` +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  '</w:styles>';

const paragraph = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** Heading 1, an intro paragraph, a gap, two plain paragraphs, then Heading 2. */
const BODY =
  paragraph('Introduction', 'Heading1') +
  paragraph('Intro') +
  paragraph('Gap') +
  paragraph('First') +
  paragraph('Second') +
  paragraph('Scope', 'Heading2');

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${MAIN}.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="${MAIN}.styles+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="${MAIN}.numbering+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${DOC_REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId2" Type="${DOC_REL}/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
  });
}

function withSurface(bytes: Uint8Array, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

function caretIn(surface: PaginatedSurface, index: number, to = index): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[index]!, offset: 0 },
    head: { paragraphId: ids[to]!, offset: 1 },
  });
}

/** The painted markers, with their size and color, in reading order. */
function markers(surface: PaginatedSurface) {
  return surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [
            fragment.marker
              ? {
                  text: fragment.marker.text,
                  size: fragment.marker.style.fontSizePt,
                  color: fragment.marker.style.color,
                }
              : null,
          ]
        : []
    );
}

const part = (bytes: Uint8Array, name: string) => strFromU8(unzipSync(bytes)[name]!);
const paragraphsOf = (bytes: Uint8Array) =>
  part(bytes, 'word/document.xml').match(/<w:p[ >].*?<\/w:p>/g) ?? [];

describe('a list button away from any list', () => {
  test('numbers a plain paragraph 1., not with the heading numbering', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 3, 4);
      expect(surface.toggleList('ordered')).toBe(true);
      const [first, second] = markers(surface).slice(3, 5);
      expect(first).toMatchObject({ text: '1.', size: 12 });
      expect(first?.color).not.toBe('5078FF');
      expect(second?.text).toBe('2.');
      // The headings keep counting on their own: Scope is still 01.1.
      expect(markers(surface)[5]?.text).toBe('01.1');
      saved = surface.save();
    });
    const numbering = part(saved!, 'word/numbering.xml');
    const numId = /<w:numId w:val="(\d+)"\/>/.exec(paragraphsOf(saved!)[3]!)?.[1];
    // A definition of its own: neither the heading numbering nor the unused plain list.
    expect(numId).not.toBe('1');
    expect(numId).not.toBe('2');
    expect(numbering.match(/<w:abstractNum /g)).toHaveLength(4);
    withSurface(saved!, (reopened) => {
      expect(
        markers(reopened)
          .slice(3, 6)
          .map((marker) => marker?.text)
      ).toEqual(['1.', '2.', '01.1']);
    });
  });

  test('a deeper level numbers a. on its own definition', () => {
    withSurface(docx(), (surface) => {
      caretIn(surface, 3);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(surface.adjustIndent('increase')).toBe(true);
      expect(markers(surface)[3]?.text).toBe('a.');
    });
  });

  test('bullets a plain paragraph on a definition of their own as well', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 3);
      expect(surface.toggleList('bullet')).toBe(true);
      saved = surface.save();
    });
    // A new bullet definition, not the document's own unused one.
    expect(part(saved!, 'word/numbering.xml').match(/<w:abstractNum /g)).toHaveLength(4);
  });

  test('pressing the button again reuses the definition it made', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 3);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(surface.toggleList('ordered')).toBe(true);
      // Second is a fresh list: First is no list item any more.
      caretIn(surface, 4);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)[4]?.text).toBe('1.');
      saved = surface.save();
    });
    // One definition of its own, used twice, besides the three the document authored.
    expect(part(saved!, 'word/numbering.xml').match(/<w:abstractNum /g)).toHaveLength(4);
  });
});

describe('a list button next to the heading numbering', () => {
  test('a paragraph just above a heading starts its own list', () => {
    withSurface(docx(), (surface) => {
      // Second sits right before the Heading 2 paragraph; only the list above would count.
      caretIn(surface, 4);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)[4]).toMatchObject({ text: '1.', size: 12 });
      expect(markers(surface)[5]?.text).toBe('01.1');
    });
  });

  test('puts the paragraph in the heading style its level is linked to', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      // Intro becomes the second heading: 02, and Scope follows it as 02.1.
      expect(
        markers(surface)
          .slice(0, 2)
          .map((marker) => marker?.text)
      ).toEqual(['01', '02']);
      expect(markers(surface)[5]?.text).toBe('02.1');
      saved = surface.save();
    });
    const intro = paragraphsOf(saved!)[1]!;
    expect(intro).toContain('<w:pStyle w:val="Heading1"/>');
    expect(intro).not.toContain('<w:numPr>');
    // No definition was made for it.
    expect(part(saved!, 'word/numbering.xml').match(/<w:abstractNum /g)).toHaveLength(3);
    withSurface(saved!, (reopened) => {
      expect(markers(reopened)[1]?.text).toBe('02');
    });
  });

  test('undo restores the plain paragraph', () => {
    withSurface(docx(), (surface) => {
      caretIn(surface, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      surface.undo();
      expect(markers(surface)[1]).toBeNull();
      expect(markers(surface)[5]?.text).toBe('01.1');
    });
  });
});
