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
function docx(bodyInner: string, extraParts: Record<string, string> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
    ...Object.fromEntries(Object.entries(extraParts).map(([k, v]) => [k, strToU8(v)])),
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

    // A read-only document saves EXACTLY as opened (nothing dropped).
    expect(session.save()).toEqual(before);
    expect(strFromU8(unzipSync(session.save())['word/document.xml'])).toContain('<w:tbl>');
  });
});

describe('the editability gate never marks a lossy document editable', () => {
  test('a document with a styles.xml part opens read-only (styles would be dropped)', () => {
    const withStyles = docx('<w:p><w:r><w:t>hi</w:t></w:r></w:p>', {
      'word/styles.xml': `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/></w:style></w:styles>`,
    });
    const session = openDocxSession(withStyles);
    expect(session.editable).toBe(false);
    expect(session.save()).toEqual(withStyles); // returned verbatim
  });

  test('a paragraph with a hyperlink opens read-only (inline structure would flatten)', () => {
    const session = openDocxSession(docx('<w:p><w:hyperlink><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>'));
    expect(session.editable).toBe(false);
  });

  test('a paragraph carrying a tab/break opens read-only', () => {
    const session = openDocxSession(docx('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>'));
    expect(session.editable).toBe(false);
  });

  test('a paragraph with section properties opens read-only (sectPr would be dropped)', () => {
    const session = openDocxSession(
      docx('<w:p><w:r><w:t>a</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'),
    );
    expect(session.editable).toBe(false);
  });

  test('a w:background before the body opens read-only (it would be dropped)', () => {
    // A shell child other than w:body (here w:background) is not reproduced by the writer.
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:background w:color="FFFF00"/>` +
          '<w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    expect(openDocxSession(bytes).editable).toBe(false);
  });

  test('a w:document attribute the writer drops (mc:Ignorable) opens read-only', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" mc:Ignorable="w14"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`,
      ),
    });
    expect(openDocxSession(bytes).editable).toBe(false);
  });

  test('an extra content-type override opens read-only (it implies a dropped part)', () => {
    const withExtraCt = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`),
    });
    expect(openDocxSession(withExtraCt).editable).toBe(false);
  });
});
