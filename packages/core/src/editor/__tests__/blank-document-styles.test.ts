// The blank template's style gallery, and the list gesture that depends on it.
//
// Word keeps its built-in styles LATENT in a new document and writes the definition the
// first time one is used. Nothing here can materialize a latent style, so the template
// has to ship them — otherwise a New document offers one style and cannot make a heading.
//
// List Paragraph is the one with a visible second job: `w:contextualSpacing` is what
// closes the 8pt gap BETWEEN consecutive list items, and `toggleList` applies the style
// the way Word's own list gesture does.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { blankDocumentBytes } from '../blank-document.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

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

function mount(bytes: Uint8Array): { editor: DocxEditorInstance; surface: PaginatedSurface } {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, surface: editor.surface };
}

/** Select from the start of one paragraph to the end of another, by document order. */
function selectParagraphs(surface: PaginatedSurface, first: number, last: number): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[first]!, offset: 0 },
    head: { paragraphId: ids[last]!, offset: 0 },
  });
}

/** The painted height of each block on page 1, in points. */
function blockHeights(surface: PaginatedSurface): number[] {
  return surface
    .layout()
    .pages[0]!.fragments.map((fragment) => Math.round(fragment.box.height * 100) / 100);
}

async function savedDocument(editor: DocxEditorInstance): Promise<string> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  return strFromU8(files['word/document.xml']!);
}

describe("the blank template's style gallery", () => {
  test("it defines Word's built-in styles, in Word's gallery order", () => {
    const { editor } = mount(blankDocumentBytes());
    const paragraphStyles = editor
      .getDocumentStyles()
      .filter((style) => style.type === 'paragraph')
      .map((style) => style.styleId);

    // Order is the gallery's, not the file's: Normal, Title, Subtitle, then the headings.
    expect(paragraphStyles).toEqual([
      'Normal',
      'Title',
      'Subtitle',
      'Heading1',
      'Heading2',
      'Heading3',
      'Heading4',
      'Heading5',
      'Heading6',
      'Heading7',
      'Heading8',
      'Heading9',
      'Quote',
      'NoSpacing',
      'ListParagraph',
    ]);
  });

  test('the default character, table and numbering styles ship too', () => {
    const { editor } = mount(blankDocumentBytes());
    const byType = new Map(
      editor.getDocumentStyles().map((style) => [style.type, style.styleId] as const)
    );
    expect(byType.get('character')).toBe('DefaultParagraphFont');
    expect(byType.get('table')).toBe('TableNormal');
    expect(byType.get('numbering')).toBe('NoList');
  });

  test('a heading is pickable on a New document and paints at its own size', () => {
    const { editor, surface } = mount(blankDocumentBytes());
    surface.type('a heading');
    const plain = blockHeights(surface)[0]!;

    expect(editor.exec({ type: 'setParagraphStyle', styleId: 'Heading1' }).ok).toBe(true);
    // 16pt text where the default is 11pt: the line has to grow.
    expect(blockHeights(surface)[0]!).toBeGreaterThan(plain);
  });
});

describe('toggleList applies List Paragraph, as Word does', () => {
  test('consecutive items close up and the list keeps its space against what follows', async () => {
    const { editor, surface } = mount(blankDocumentBytes());
    surface.type('one');
    surface.splitParagraph();
    surface.type('two');
    surface.splitParagraph();
    surface.type('after');

    selectParagraphs(surface, 0, 1);
    expect(surface.toggleList('bullet')).toBe(true);

    const document = await savedDocument(editor);
    expect(document).toContain(
      '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>one</w:t></w:r>'
    );
    // The paragraph the list does NOT cover keeps the defaults, with no style of its own.
    expect(document).toContain('<w:p w14:paraId="67A062B7" w14:textId="67A062B7"><w:r>');

    // One line each. The first item drops its 8pt space-after because the item under it is
    // the same style; the last item keeps it, because "after" is not.
    const [first, second, third] = blockHeights(surface);
    expect(second! - first!).toBe(8);
    expect(third).toBe(second);
  });

  test('bulleting a heading leaves it a heading', async () => {
    const { editor, surface } = mount(blankDocumentBytes());
    surface.type('a heading');
    expect(editor.exec({ type: 'setParagraphStyle', styleId: 'Heading1' }).ok).toBe(true);
    expect(surface.toggleList('bullet')).toBe(true);

    const document = await savedDocument(editor);
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).not.toContain('ListParagraph');
  });

  test('turning the list back off keeps the style, as Word does', async () => {
    const { editor, surface } = mount(blankDocumentBytes());
    surface.type('one');
    expect(surface.toggleList('bullet')).toBe(true);
    expect(surface.toggleList('bullet')).toBe(true);

    const document = await savedDocument(editor);
    expect(document).toContain('<w:pStyle w:val="ListParagraph"/>');
    expect(document).not.toContain('<w:numPr>');
  });

  test('a document defining no List Paragraph style still bullets, with no dangling pStyle', async () => {
    const { editor, surface } = mount(
      docx(
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
        '<w:p><w:r><w:t>one</w:t></w:r></w:p>'
      )
    );
    expect(surface.toggleList('bullet')).toBe(true);

    const document = await savedDocument(editor);
    expect(document).toContain('<w:numPr>');
    expect(document).not.toContain('<w:pStyle');
  });

  test('the style is found by NAME when the file spells the id its own way', async () => {
    const { editor, surface } = mount(
      docx(
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="a3"><w:name w:val="List Paragraph"/>' +
          '<w:pPr><w:contextualSpacing/></w:pPr></w:style>',
        '<w:p><w:r><w:t>one</w:t></w:r></w:p>'
      )
    );
    expect(surface.toggleList('bullet')).toBe(true);
    expect(await savedDocument(editor)).toContain('<w:pStyle w:val="a3"/>');
  });
});
