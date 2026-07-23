// Headless editing vertical (queue item 3): the engine-neutral session both adapters
// wrap. Proves the full loop WITHOUT a browser — real DOCX -> PackageModel -> store ->
// EditorBinding -> an edited ProseMirror doc -> ONE DocOp transaction -> canonical store
// -> save DOCX -> reopen with the edit preserved. Documents with tables/SDTs open
// read-only (edits are refused, save stays verbatim); nothing is ever flattened.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { docSchema } from '@docx-editor.dev/engine-binding';
import { openDocxSession } from './docxEditorSession.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docx(bodyInner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
  });
}
const PARAS = '<w:p><w:r><w:t>hello</w:t></w:r></w:p><w:p><w:r><w:t>world</w:t></w:r></w:p>';
const WITH_TABLE =
  '<w:p><w:r><w:t>intro</w:t></w:r></w:p>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

/** Rebuild a PM doc with the first paragraph's text replaced (atoms/others preserved). */
function withFirstParagraphText(doc: import('prosemirror-model').Node, text: string) {
  const children: import('prosemirror-model').Node[] = [];
  let replaced = false;
  doc.forEach((n) => {
    if (!replaced && n.type.name === 'paragraph') {
      children.push(docSchema.node('paragraph', n.attrs, text ? docSchema.text(text) : undefined));
      replaced = true;
    } else children.push(n);
  });
  return docSchema.node('doc', null, children);
}

describe('paragraph-only document: full load -> edit -> save -> reopen loop', () => {
  test('a typed edit maps to one DocOp, commits, and survives save + reopen', () => {
    const session = openDocxSession(docx(PARAS));
    expect(session.editable).toBe(true);
    expect(session.bodyText()).toBe('hello\nworld');

    const edited = withFirstParagraphText(session.projectDoc(), 'HELLO EDIT');
    const res = session.applyPmDoc(edited);
    expect(res.rejected).toBe(false);
    expect(res.committed).toBe(true);
    expect(res.opCount).toBe(1);
    expect(session.bodyText()).toBe('HELLO EDIT\nworld');

    // Save and reopen: the edit is in the canonical, persisted DOCX.
    const saved = session.save();
    expect(strFromU8(unzipSync(saved)['word/document.xml'])).toContain('HELLO EDIT');
    const reopened = openDocxSession(saved);
    expect(reopened.bodyText()).toBe('HELLO EDIT\nworld');
  });

  test('reprojecting without editing commits nothing (loop prevention)', () => {
    const session = openDocxSession(docx(PARAS));
    const res = session.applyPmDoc(session.projectDoc());
    expect(res.committed).toBe(false);
    expect(res.opCount).toBe(0);
  });
});

describe('document with a table: read-only, verbatim, never flattened', () => {
  test('opens read-only; edits are refused and the save stays byte-identical', () => {
    const before = docx(WITH_TABLE);
    const session = openDocxSession(before);
    expect(session.editable).toBe(false);

    // An attempted edit is refused (no commit) — the store is untouched.
    const edited = withFirstParagraphText(session.projectDoc(), 'nope');
    const res = session.applyPmDoc(edited);
    expect(res.committed).toBe(false);
    expect(res.rejected).toBe(true);
    expect(session.bodyText()).toBe('intro'); // unchanged

    // The table is still present and the document saves byte-identically.
    const after = session.save();
    expect(strFromU8(unzipSync(after)['word/document.xml'])).toBe(
      strFromU8(unzipSync(before)['word/document.xml']),
    );
    expect(strFromU8(unzipSync(after)['word/document.xml'])).toContain('<w:tbl>');
  });
});
