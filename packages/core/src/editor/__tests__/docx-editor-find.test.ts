// The facade's find lane: `Editor.findMatches` / `Editor.selectMatch`.
//
// What these pin down: find is a READ that answers from the tree and never moves the
// caret, selecting a match is the separate write that puts the selection exactly on it in
// the surface's own offset vocabulary, and a malformed match is refused rather than
// resolved approximately — a find dialog that selects the wrong span is worse than one
// that reports it cannot.
//
// The derivation itself (ordering, offsets, case, whole word, bounds) is pinned in
// `binding/__tests__/document-search.test.ts`; these are the facade seam only.

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

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('Editor find', () => {
  test('findMatches answers from the tree, and selectMatch moves the selection onto one', () => {
    const editor = mount(p('Exhibit A') + p('See Exhibit B'));
    const matches = editor.findMatches('exhibit');
    expect(matches).toHaveLength(2);

    expect(editor.selectMatch(matches[1]!)).toEqual({ ok: true, changed: false });
    // The selection covers exactly the match, in the surface's own offset vocabulary.
    const selection = editor.surface!.state().selection;
    expect(selection.anchor.paragraphId).toBe(matches[1]!.blockId);
    expect([selection.anchor.offset, selection.head.offset]).toEqual([4, 11]);
  });

  test('findMatches narrows on matchCase and wholeWord', () => {
    const editor = mount(p('Exhibit exhibit exhibits'));
    expect(editor.findMatches('exhibit')).toHaveLength(3);
    expect(editor.findMatches('exhibit', { matchCase: true })).toHaveLength(2);
    expect(editor.findMatches('exhibit', { wholeWord: true })).toHaveLength(2);
  });

  test('findMatches carries the surrounding text a result row renders', () => {
    const editor = mount(p('as described in this Exhibit A ("Support Services")'));
    const match = editor.findMatches('Exhibit')[0]!;
    expect(match.contextBefore).toBe('as described in this ');
    expect(match.contextAfter).toBe(' A ("Support Services")');
  });

  test('findMatches is a read: it never moves the caret', () => {
    const editor = mount(p('Exhibit A') + p('See Exhibit B'));
    const before = editor.surface!.state().selection;
    editor.findMatches('exhibit');
    expect(editor.surface!.state().selection).toEqual(before);
  });

  test('selectMatch refuses a malformed match rather than selecting somewhere else', () => {
    const editor = mount(p('Exhibit A'));
    expect(
      editor.selectMatch({
        blockId: '',
        start: 0,
        length: 1,
        paragraphIndex: 0,
        runIndex: 0,
        runOffset: 0,
        text: 'E',
      })
    ).toMatchObject({ ok: false, code: 'invalidArgs' });
  });
});
