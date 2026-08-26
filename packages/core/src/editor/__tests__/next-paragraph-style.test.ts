// Word's `w:next`: Enter at the end of a paragraph starts one in the style that paragraph's
// style names as its follower. A heading is followed by body text, not by another heading.
//
// The rule is about where the caret is, not about the split: Enter in the MIDDLE of a
// heading gives two headings, and Enter at its START gives an empty heading above.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';
import { directParagraphProperties } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

function docx(styles: string, body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STY}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** A Normal that follows itself, and a Heading 1 that follows into Normal — Word's own shape. */
const STYLES =
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/><w:next w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
  `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
  `<w:pPr><w:outlineLvl w:val="0"/><w:jc w:val="center"/></w:pPr>` +
  `<w:rPr><w:sz w:val="40"/></w:rPr></w:style>`;

const HEADING = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>`;

/** Torn down after each test: a container left on `document` leaks into the serial run. */
const mounted: { editor: DocxEditorInstance; container: HTMLElement }[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.editor.destroy();
    entry.container.remove();
  }
});

function mount(
  bytes: Uint8Array,
  author?: string
): { editor: DocxEditorInstance; surface: PaginatedSurface } {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes, author });
  mounted.push({ editor, container });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, surface: editor.surface };
}

/** The property names each body paragraph authors in its own `w:pPr`, in order. */
function authoredNames(surface: PaginatedSurface, index: number): string[] {
  return directParagraphProperties(
    surface.session.part(),
    surface.session.paragraphIds()[index]!
  ).map((property) => property.localName);
}

/** The `w:pStyle` each body paragraph authors, `null` where it authors none. */
function authoredStyles(surface: PaginatedSurface): (string | null)[] {
  const part = surface.session.part();
  return surface.session
    .paragraphIds()
    .map(
      (id) =>
        directParagraphProperties(part, id).find((property) => property.localName === 'pStyle')
          ?.attributes?.val ?? null
    );
}

function pressEnterAt(surface: PaginatedSurface, index: number, offset: number): void {
  const id = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
  surface.splitParagraph();
}

describe('Enter and the style for the following paragraph', () => {
  test('Enter at the end of a heading starts a body paragraph', () => {
    const { surface } = mount(docx(STYLES, HEADING));
    pressEnterAt(surface, 0, 5);
    // Normal is the document default, so Word authors no `w:pStyle` at all for it.
    expect(authoredStyles(surface)).toEqual(['Heading1', null]);
  });

  test('Enter inside a heading gives two headings', () => {
    const { surface } = mount(docx(STYLES, HEADING));
    pressEnterAt(surface, 0, 2);
    expect(authoredStyles(surface)).toEqual(['Heading1', 'Heading1']);
  });

  test('Enter at the start of a heading leaves an empty heading above it', () => {
    const { surface } = mount(docx(STYLES, HEADING));
    pressEnterAt(surface, 0, 0);
    expect(authoredStyles(surface)).toEqual(['Heading1', 'Heading1']);
  });

  test('a style that follows itself leaves the new paragraph alone', () => {
    const { surface } = mount(docx(STYLES, `<w:p><w:r><w:t>Body</w:t></w:r></w:p>`));
    pressEnterAt(surface, 0, 4);
    expect(authoredStyles(surface)).toEqual([null, null]);
  });

  test('a `w:next` the document never defines leaves the new paragraph alone', () => {
    const styles =
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
      `<w:next w:val="NoSuchStyle"/></w:style>`;
    const { surface } = mount(docx(styles, HEADING));
    pressEnterAt(surface, 0, 5);
    expect(authoredStyles(surface)).toEqual(['Heading1', 'Heading1']);
  });

  test('the new paragraph keeps the direct formatting the heading carried', () => {
    const body =
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:ind w:left="720"/></w:pPr>` +
      `<w:r><w:t>Title</w:t></w:r></w:p>`;
    const { surface } = mount(docx(STYLES, body));
    pressEnterAt(surface, 0, 5);
    expect(authoredStyles(surface)).toEqual(['Heading1', null]);
    // Word carries indents, spacing and borders across Enter. Only the style is decided anew.
    expect(authoredNames(surface, 1)).toEqual(['ind']);
  });

  test('a suggested break keeps the style, so rejecting it restores the heading', () => {
    // A suggested Enter proposes a `w:ins` mark on the HEAD, and rejecting it merges the
    // two paragraphs back keeping the SURVIVING tail's `w:pPr`. A tail in the follower
    // style would therefore demote the very heading the reviewer took the break back from.
    // Word records a `w:pPrChange` for this; there is no tracked paragraph-property write
    // here, so the follower style is declined instead.
    const { surface } = mount(docx(STYLES, HEADING), 'Ada Lovelace');
    surface.setEditingMode('suggest');
    pressEnterAt(surface, 0, 5);
    expect(authoredStyles(surface)).toEqual(['Heading1', 'Heading1']);
    surface.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(authoredStyles(surface)).toEqual(['Heading1']);
  });

  test('text struck at the end of a paragraph is not the end of the paragraph', () => {
    // `proposed` display mode does not paint struck runs, so the layout's text stops short
    // of the model's. Reading "am I at the end" off the layout put the caret at the end of
    // a heading that still had content after it, and the struck words fell into a tail
    // wearing the follower style.
    const body =
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r>` +
      `<w:del w:id="1" w:author="Grace Hopper" w:date="2026-01-01T00:00:00Z">` +
      `<w:r><w:delText> draft</w:delText></w:r></w:del></w:p>`;
    const { surface } = mount(docx(STYLES, body));
    pressEnterAt(surface, 0, 5);
    expect(authoredStyles(surface)).toEqual(['Heading1', 'Heading1']);
  });

  test('the follow-on style survives a save', async () => {
    const { editor, surface } = mount(docx(STYLES, HEADING));
    pressEnterAt(surface, 0, 5);
    const bytes = new Uint8Array(await editor.save());
    const reopened = mount(bytes);
    expect(authoredStyles(reopened.surface)).toEqual(['Heading1', null]);
  });
});
