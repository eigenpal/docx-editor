// Section breaks through the Editor facade: Word's Layout > Breaks, end to end.
//
// What these pin down: `insertBreak` splits the `w:sectPr` chain at the caret, `w:type`
// lands on the section that STARTS at the mark rather than on the minted clone, and each
// break kind paginates the way Word does — a next-page break starts a sheet, a continuous
// one does not. Against the REAL surface: painted pages, committed ops, one undo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function mount(body: string, mode: 'edit' | 'suggesting' = 'edit'): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    mode,
    author: 'Ada Lovelace',
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/** Every `w:sectPr/w:type` value in the live part, in document order. */
function sectionTypes(editor: DocxEditorInstance): string[] {
  const found: string[] = [];
  const walk = (node: {
    kind: string;
    localName?: string;
    attributes?: readonly { localName: string; value: string }[];
    children?: readonly unknown[];
  }): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'type') {
      found.push(node.attributes?.find((a) => a.localName === 'val')?.value ?? '');
    }
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(editor.surface!.session.part().root as never);
  return found;
}

/** Caret between "before" and " after". */
function caretMidParagraph(editor: DocxEditorInstance): void {
  const id = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset: 6 },
    head: { paragraphId: id, offset: 6 },
  });
}

describe('insertBreak section kinds', () => {
  test('section splits at the caret and starts a new section', () => {
    const editor = mount(p('before after'));
    caretMidParagraph(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertBreak', kind: 'section' } as never)).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
    // The document now has two sections; one undo removes the break entirely.
    expect(editor.surface!.layout().pages.length).toBeGreaterThanOrEqual(2);
    editor.exec({ type: 'undo' });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
  });

  test('sectionContinuous splits the section without splitting the page', () => {
    const editor = mount(p('before after'));
    caretMidParagraph(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
    // The section boundary is real, but both halves stay on the sheet they started on —
    // that is the whole difference from the next-page break above.
    expect(editor.surface!.layout().pages).toHaveLength(1);
    expect(sectionTypes(editor)).toEqual(['continuous']);
    editor.exec({ type: 'undo' });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
    expect(sectionTypes(editor)).toEqual([]);
  });

  test('a next-page break inside a continuous section really starts a page', () => {
    // The minted mark CLONES the governing section, `w:type` and all. Left alone, a
    // next-page break cut from a continuous section came out continuous and both halves
    // stayed on one sheet — the gesture committing and changing nothing on screen.
    const editor = mount(
      p('before after') +
        '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    caretMidParagraph(editor);
    expect(editor.exec({ type: 'insertBreak', kind: 'section' } as never)).toEqual({
      ok: true,
      changed: true,
    });
    // The clone keeps `continuous` (it says where the FIRST half starts, which has not
    // moved); the section starting at the break is retyped to nextPage by removal.
    expect(sectionTypes(editor)).toEqual(['continuous']);
    expect(editor.surface!.layout().pages).toHaveLength(2);
  });

  test('the caret section drives the layout: a landscape section paginates landscape', () => {
    const editor = mount(
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>landscape page</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>portrait page</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const pages = editor.surface!.layout().pages;
    expect(pages).toHaveLength(2);
    // Twips to points: 15840/20 = 792 wide landscape sheet, then the portrait one.
    expect([pages[0]!.box.width, pages[0]!.box.height]).toEqual([792, 612]);
    expect([pages[1]!.box.width, pages[1]!.box.height]).toEqual([612, 792]);
  });
});

describe('suggesting mode publishes the one break it cannot propose', () => {
  // The reason has to reach `can`, not just `exec`: a gate the toolbar cannot see is a
  // button that lies. The row greys out and carries the engine's own words.
  const SUGGESTED_REASON =
    'a section break that changes where the next section starts cannot be suggested; ' +
    'turn off suggesting to insert it';

  function caretIn(editor: DocxEditorInstance): void {
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 6 },
      head: { paragraphId: id, offset: 6 },
    });
  }

  test('a continuous break reports the refusal through can, and changes nothing', () => {
    const editor = mount(p('before after'), 'suggesting');
    caretIn(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toEqual({
      ok: false,
      code: 'unsupported',
      reason: SUGGESTED_REASON,
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'sectionContinuous' } as never)).toMatchObject({
      ok: false,
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
    expect(sectionTypes(editor)).toEqual([]);
  });

  test('a next-page break that would REMOVE an authored type is refused with it', () => {
    const editor = mount(
      p('before after') +
        '<w:sectPr><w:type w:val="oddPage"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
      'suggesting'
    );
    caretIn(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toMatchObject({
      ok: false,
      reason: SUGGESTED_REASON,
    });
    expect(sectionTypes(editor)).toEqual(['oddPage']);
  });

  test('the ordinary next-page break is untouched: it retypes nothing', () => {
    const editor = mount(p('before after'), 'suggesting');
    caretIn(editor);
    expect(editor.can({ type: 'insertBreak', kind: 'section' } as never)).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertBreak', kind: 'section' } as never)).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
  });
});
