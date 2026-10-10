/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor, type DocxEditorRuntime } from '@docx-editor.dev/editor-api';
import { DocxEditor as BrowserDocxEditor } from '@docx-editor.dev/editor-api/browser';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '@docx-editor.dev/pro';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
function fixture(): Uint8Array {
  const paragraph = (text: string, note?: number) =>
    `<w:p><w:r><w:t>${text}</w:t></w:r>${note ? `<w:r><w:footnoteReference w:id="${note}"/></w:r>` : ''}</w:p>`;
  const cell = (text: string, note?: number) =>
    `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraph(text, note)}</w:tc>`;
  const table = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr>${cell('DELETE ANCHOR', 1)}${cell('Upper right')}</w:tr><w:tr>${cell('Lower left')}${cell('SURVIVING CELL', 2)}</w:tr></w:tbl>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${R}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${R}"><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${table}${paragraph('OUTSIDE SENTINEL', 3)}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${[1, 2, 3].map((id) => `<w:footnote w:id="${id}">${paragraph(`NOTE BODY ${id}`)}</w:footnote>`).join('')}</w:footnotes>`
    ),
  });
}
async function addComments(runtime: DocxEditorRuntime) {
  for (const quote of ['DELETE ANCHOR', 'SURVIVING CELL', 'OUTSIDE SENTINEL']) {
    await runtime.run(async (context) => {
      const matches = context.document.body.search(quote);
      matches.load('items');
      await context.sync();
      expect(matches.items.length).toBe(1);
      matches.items[0]!.insertComment(`COMMENT ${quote}`);
      await context.sync();
    });
  }
}
async function snapshot(runtime: DocxEditorRuntime) {
  return runtime.run(async (context) => {
    const d = context.document;
    d.comments.load('items');
    d.footnotes.load('items');
    d.body.load('text');
    await context.sync();
    for (const c of d.comments.items) c.load('text');
    for (const n of d.footnotes.items) n.load('text');
    await context.sync();
    return {
      text: d.body.text,
      comments: d.comments.items.map((c) => c.text),
      notes: d.footnotes.items.map((n) => n.text),
    };
  });
}
async function remove(runtime: DocxEditorRuntime, kind: 'row' | 'column' | 'table') {
  await runtime.run(async (context) => {
    const tables = context.document.body.tables;
    tables.load('items');
    await context.sync();
    if (kind === 'row') tables.items[0]!.deleteRows(0, 1);
    else if (kind === 'column') tables.items[0]!.deleteColumns(0, 1);
    else tables.items[0]!.delete();
    await context.sync();
  });
}
async function verifySaved(bytes: Uint8Array, kind: 'row' | 'column' | 'table') {
  const reopened = await DocxEditor.createServer(bytes);
  try {
    const result = await snapshot(reopened);
    expect(result.comments).toEqual(
      kind === 'table'
        ? ['COMMENT OUTSIDE SENTINEL']
        : ['COMMENT SURVIVING CELL', 'COMMENT OUTSIDE SENTINEL']
    );
    expect(result.notes).toEqual(
      kind === 'table' ? ['NOTE BODY 3'] : ['NOTE BODY 2', 'NOTE BODY 3']
    );
    expect(result.text).toContain('OUTSIDE SENTINEL');
    const parts = unzipSync(bytes);
    const comments = strFromU8(parts['word/comments.xml']!);
    const notes = strFromU8(parts['word/footnotes.xml']!);
    expect(comments).not.toContain('COMMENT DELETE ANCHOR');
    expect(notes).not.toContain('NOTE BODY 1');
    expect(comments).toContain('COMMENT OUTSIDE SENTINEL');
    expect(notes).toContain('NOTE BODY 3');
    if (kind === 'table') {
      expect(comments).not.toContain('COMMENT SURVIVING CELL');
      expect(notes).not.toContain('NOTE BODY 2');
    }
    return result;
  } finally {
    reopened.dispose();
  }
}

for (const kind of ['row', 'column', 'table'] as const) {
  test(`public server ${kind} deletion cleans removed comments and notes while preserving survivors`, async () => {
    const runtime = await DocxEditor.createServer(fixture(), { author: 'Cleanup reviewer' });
    try {
      await addComments(runtime);
      await remove(runtime, kind);
      await verifySaved(await runtime.save(), kind);
    } finally {
      runtime.dispose();
    }
  });
  test(`public browser ${kind} deletion cleanup survives save, undo and redo`, async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: fixture(),
      modules: [reviewModule()],
      author: 'Cleanup reviewer',
    });
    const runtime = BrowserDocxEditor.createBrowser(editor, { author: 'Cleanup reviewer' });
    try {
      await addComments(runtime);
      const before = await snapshot(runtime);
      await remove(runtime, kind);
      const after = await verifySaved(new Uint8Array(await editor.save()), kind);
      editor.exec({ type: 'undo' });
      expect(await snapshot(runtime)).toEqual(before);
      const undoReopened = await DocxEditor.createServer(new Uint8Array(await editor.save()));
      try {
        expect(await snapshot(undoReopened)).toEqual(before);
      } finally {
        undoReopened.dispose();
      }
      editor.exec({ type: 'redo' });
      expect(await verifySaved(new Uint8Array(await editor.save()), kind)).toEqual(after);
    } finally {
      runtime.dispose();
      editor.destroy();
      container.remove();
    }
  });
}
