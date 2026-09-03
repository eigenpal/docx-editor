import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { FOOTNOTE_SCOPE_ID, HEADER_R_ID, storyParityDocx } from './story-parity-fixture.ts';

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

function storyParityDocxWithBodyTable(): Uint8Array {
  const files = unzipSync(storyParityDocx());
  const documentXml = strFromU8(files['word/document.xml']!);
  const table =
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  files['word/document.xml'] = strToU8(documentXml.replace('<w:sectPr>', `${table}<w:sectPr>`));
  return zipSync(files);
}

describe('document search facade', () => {
  test('selects a match inside a table cell by paragraph id', () => {
    const body =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>one</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>four</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(body),
    });
    if (!editor.surface) throw new Error('surface did not open');
    const matches = editor.findMatches('four');

    expect(matches).toHaveLength(1);
    expect(editor.selectMatch(matches[0]!)).toEqual({ ok: true, changed: false });
    const paraId = editor.surface.session.paraIdOf(matches[0]!.blockId);
    expect(paraId).not.toBeNull();
    expect(editor.snapshot().selection).toEqual({
      from: { paraId },
      to: { paraId },
    });
    expect(editor.surface.state().selection).toEqual({
      anchor: { paragraphId: matches[0]!.blockId, offset: 0 },
      head: { paragraphId: matches[0]!.blockId, offset: 4 },
    });
  });

  test('opens a header and selects its match', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });
    const match = editor
      .findMatches('Alpha')
      .find((candidate) => candidate.scope?.kind === 'headerFooter');
    if (!match || !editor.surface) throw new Error('header match did not open');

    expect(editor.selectMatch(match)).toEqual({ ok: true, changed: false });
    expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: HEADER_R_ID });
    expect(editor.surface.state().selection).toEqual({
      anchor: { paragraphId: match.blockId, offset: 0 },
      head: { paragraphId: match.blockId, offset: 5 },
    });
    editor.destroy();
  });

  test('opens a footnote and selects its match', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });
    const match = editor.findMatches('Alpha').find((candidate) => candidate.scope?.kind === 'note');
    if (!match || !editor.surface) throw new Error('footnote match did not open');

    expect(editor.selectMatch(match)).toEqual({ ok: true, changed: false });
    expect(editor.getActiveScope()).toEqual({ kind: 'note', id: FOOTNOTE_SCOPE_ID });
    expect(editor.surface.state().selection).toEqual({
      anchor: { paragraphId: match.blockId, offset: 0 },
      head: { paragraphId: match.blockId, offset: 5 },
    });
    editor.destroy();
  });

  test('leaves an open header when selecting a body match', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });
    const matches = editor.findMatches('Alpha');
    const header = matches.find((candidate) => candidate.scope?.kind === 'headerFooter');
    const body = matches.find((candidate) => candidate.scope === undefined);
    if (!header || !body) throw new Error('search matches are incomplete');
    expect(editor.selectMatch(header).ok).toBe(true);

    expect(editor.selectMatch(body)).toEqual({ ok: true, changed: false });
    expect(editor.getActiveScope()).toEqual({ kind: 'body' });
    expect(editor.surface?.state().selection.head.paragraphId).toBe(body.blockId);
    editor.destroy();
  });

  test('searches scoped stories only while the surface can open them', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });

    expect(editor.findMatches('Alpha')).toHaveLength(5);
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    expect(editor.findMatches('Alpha')).toHaveLength(1);
    expect(editor.findMatches('Alpha')[0]!.scope).toBeUndefined();
    expect(editor.exec({ type: 'setEditingMode', mode: 'editing' }).ok).toBe(true);
    expect(editor.findMatches('Alpha')).toHaveLength(5);
    editor.destroy();
  });

  test('limits a view-only editor to body matches', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
      mode: 'view',
    });

    expect(editor.findMatches('Alpha')).toHaveLength(1);
    expect(editor.findMatches('Alpha')[0]!.scope).toBeUndefined();
    editor.destroy();
  });

  test('limits search to the body when a scoped entry method is unavailable', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });
    if (!editor.surface) throw new Error('surface did not open');
    Object.defineProperty(editor.surface, 'enterNote', { configurable: true, value: undefined });

    expect(editor.findMatches('Alpha')).toHaveLength(1);
    expect(editor.findMatches('Alpha')[0]!.scope).toBeUndefined();
    editor.destroy();
  });

  test('keeps an open note when scrollToBlock receives a table id', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocxWithBodyTable(),
    });
    if (!editor.surface) throw new Error('surface did not open');
    const table = editor.surface
      .layout()
      .pages.flatMap((page) => page.fragments)
      .find((fragment) => fragment.kind === 'table');
    if (!table || table.kind !== 'table') throw new Error('table did not lay out');
    expect(editor.surface.enterNote(FOOTNOTE_SCOPE_ID)).toBe(true);

    editor.scrollToBlock(table.tableId);

    expect(editor.getActiveScope()).toEqual({ kind: 'note', id: FOOTNOTE_SCOPE_ID });
    editor.destroy();
  });
});
