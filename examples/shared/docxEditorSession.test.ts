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
    expect(session.readOnlyReason).toBeNull(); // editable -> no read-only diagnostic
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

describe('structural editing: split (Enter) and join survive save + reopen', () => {
  test('splitting the first paragraph commits and round-trips', () => {
    const session = openDocxSession(docx(PARAS)); // hello | world
    const doc = session.projectDoc();
    const first = doc.child(0);
    const split = docSchema.node('doc', null, [
      docSchema.node('paragraph', first.attrs, docSchema.text('hel')),
      docSchema.node('paragraph', { semId: null }, docSchema.text('lo')),
      doc.child(1),
    ]);
    const res = session.applyPmDoc(split);
    expect(res.committed).toBe(true);
    expect(res.rejected).toBe(false);
    expect(res.opCount).toBe(1);
    expect(session.bodyText()).toBe('hel\nlo\nworld');
    // Save + reopen: the new paragraph structure is in the persisted DOCX.
    const reopened = openDocxSession(session.save());
    expect(reopened.bodyText()).toBe('hel\nlo\nworld');
  });

  test('pasting new paragraphs at a boundary commits and round-trips', () => {
    const session = openDocxSession(docx(PARAS)); // hello | world
    const doc = session.projectDoc();
    const pasted = docSchema.node('doc', null, [
      doc.child(0),
      docSchema.node('paragraph', { semId: null }, docSchema.text('one')),
      docSchema.node('paragraph', { semId: null }, docSchema.text('two')),
      doc.child(1),
    ]);
    const res = session.applyPmDoc(pasted);
    expect(res.committed).toBe(true);
    expect(res.opCount).toBe(2);
    expect(session.bodyText()).toBe('hello\none\ntwo\nworld');
    expect(openDocxSession(session.save()).bodyText()).toBe('hello\none\ntwo\nworld');
  });

  test('a mid-paragraph paste commits and round-trips', () => {
    const session = openDocxSession(docx(PARAS)); // hello | world
    const doc = session.projectDoc();
    // Paste 'AAA\nBBB\nCCC' at offset 3 of 'hello': the paragraph keeps its id ('hel'+'AAA'),
    // two new paragraphs, the last carrying the tail ('CCC'+'lo').
    const pasted = docSchema.node('doc', null, [
      docSchema.node('paragraph', doc.child(0).attrs, docSchema.text('helAAA')),
      docSchema.node('paragraph', { semId: null }, docSchema.text('BBB')),
      docSchema.node('paragraph', { semId: null }, docSchema.text('CCClo')),
      doc.child(1),
    ]);
    const res = session.applyPmDoc(pasted);
    expect(res.committed).toBe(true);
    expect(res.opCount).toBe(3); // setParagraphRuns + 2 inserts
    expect(session.bodyText()).toBe('helAAA\nBBB\nCCClo\nworld');
    expect(openDocxSession(session.save()).bodyText()).toBe('helAAA\nBBB\nCCClo\nworld');
  });

  test('joining two paragraphs commits and round-trips', () => {
    const session = openDocxSession(docx(PARAS)); // hello | world
    const doc = session.projectDoc();
    const join = docSchema.node('doc', null, [
      docSchema.node('paragraph', doc.child(0).attrs, docSchema.text('helloworld')),
    ]);
    const res = session.applyPmDoc(join);
    expect(res.committed).toBe(true);
    expect(res.opCount).toBe(1);
    expect(session.bodyText()).toBe('helloworld');
    expect(openDocxSession(session.save()).bodyText()).toBe('helloworld');
  });
});

describe('paragraph-properties capsule: a styled paragraph is editable, w:pPr preserved (3.1/3.2)', () => {
  const STYLED =
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>body</w:t></w:r></w:p>';

  test('a paragraph carrying w:pPr now opens editable (was read-only)', () => {
    const session = openDocxSession(docx(STYLED));
    expect(session.editable).toBe(true);
    expect(session.readOnlyReason).toBeNull();
  });

  test('editing the styled paragraph text preserves its w:pPr verbatim through save + reopen', () => {
    const session = openDocxSession(docx(STYLED));
    const res = session.applyPmDoc(withFirstParagraphText(session.projectDoc(), 'New Title'));
    expect(res.committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    // The w:pPr capsule (style + justification) is re-spliced byte-exact ahead of the edited runs.
    expect(savedXml).toContain('<w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>');
    expect(savedXml).toContain('New Title');
    // Reopen: the edit survives and the styled paragraph is still editable + still carries its w:pPr.
    const reopened = openDocxSession(session.save());
    expect(reopened.editable).toBe(true);
    expect(reopened.bodyText()).toBe('New Title\nbody');
    expect(strFromU8(unzipSync(reopened.save())['word/document.xml'])).toContain('<w:pStyle w:val="Heading1"/>');
  });

  test('a w:pPr that is not cleanly capturable (comment before it) keeps the document read-only', () => {
    const uncapturable = '<w:p><!-- x --><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>t</w:t></w:r></w:p>';
    expect(openDocxSession(docx(uncapturable)).editable).toBe(false);
  });

  test('a table cell paragraph with opening-tag WHITESPACE keeps the table read-only (no lexical loss)', () => {
    // A cell paragraph does not capture an attributes capsule; opening-tag whitespace would be lost
    // on regeneration, so the whole table stays read-only.
    const cellWs = '<w:p><w:r><w:t>intro</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p\n ><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    expect(openDocxSession(docx(cellWs)).editable).toBe(false);
  });

  test('joining a styled paragraph with the next keeps the FIRST paragraph w:pPr (first-survivor)', () => {
    const session = openDocxSession(docx(STYLED));
    const doc = session.projectDoc();
    // Merge "Title" + "body" into one paragraph carrying the first (styled) paragraph's id.
    const joined = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: doc.child(0).attrs.semId }, docSchema.text('Titlebody')),
    ]);
    const res = session.applyPmDoc(joined);
    expect(res.committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    expect(savedXml).toContain('<w:pStyle w:val="Heading1"/>'); // the surviving paragraph's w:pPr
    expect(session.bodyText()).toBe('Titlebody');
  });

  test('splitting a styled paragraph gives BOTH halves the w:pPr (structural edit, no loss)', () => {
    const session = openDocxSession(docx(STYLED));
    const doc = session.projectDoc();
    // Split the first paragraph "Title" into "Ti" + "tle": head keeps its semId, tail is new (null).
    const first = doc.child(0);
    const headSemId = first.attrs.semId;
    const split = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: headSemId }, docSchema.text('Ti')),
      docSchema.node('paragraph', { semId: null }, docSchema.text('tle')),
      ...Array.from({ length: doc.childCount - 1 }, (_, i) => doc.child(i + 1)),
    ]);
    const res = session.applyPmDoc(split);
    expect(res.committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    // Both halves carry the paragraph style/justification; the split text round-trips.
    expect(savedXml.match(/<w:pStyle w:val="Heading1"\/>/g)?.length).toBe(2);
    expect(session.bodyText()).toBe('Ti\ntle\nbody');
    // Reopen: both styled paragraphs survive.
    const reopened = openDocxSession(session.save());
    expect(reopened.bodyText()).toBe('Ti\ntle\nbody');
    expect(reopened.editable).toBe(true);
  });
});

describe('paragraph-attributes capsule: rsid/paraId paragraphs are editable, attrs preserved (3.1/3.2)', () => {
  const RSID =
    '<w:p w:rsidR="00AB12" w14:paraId="1F2E3D4C"><w:r><w:t>alpha</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>beta</w:t></w:r></w:p>';
  const rsidDoc = () => docx(RSID);

  test('a paragraph carrying w:rsidR + w14:paraId opens editable, attrs preserved through save+reopen', () => {
    const session = openDocxSession(rsidDoc());
    expect(session.editable).toBe(true);
    const res = session.applyPmDoc(withFirstParagraphText(session.projectDoc(), 'ALPHA'));
    expect(res.committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    expect(savedXml).toContain('<w:p w:rsidR="00AB12" w14:paraId="1F2E3D4C">'); // attributes re-spliced byte-exact
    expect(savedXml).toContain('ALPHA');
    expect(openDocxSession(session.save()).bodyText()).toBe('ALPHA\nbeta');
  });

  test('an UNRELATED self-closing empty paragraph stays byte-exact through a structural edit', () => {
    // A self-closing <w:p/> that is not touched by a split must not be expanded to <w:p></w:p>.
    const doc = '<w:p/><w:p><w:r><w:t>abcd</w:t></w:r></w:p>';
    const session = openDocxSession(docx(doc));
    expect(session.editable).toBe(true);
    const pm = session.projectDoc();
    // Split the SECOND paragraph "abcd" -> "ab" + "cd"; the first (empty self-closed) is untouched.
    const split = docSchema.node('doc', null, [
      pm.child(0),
      docSchema.node('paragraph', { semId: pm.child(1).attrs.semId }, docSchema.text('ab')),
      docSchema.node('paragraph', { semId: null }, docSchema.text('cd')),
    ]);
    expect(session.applyPmDoc(split).committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    expect(savedXml).toContain('<w:p/>'); // the untouched empty paragraph kept its self-closing form
  });

  test('splitting keeps the tail namespace context its inherited w:pPr needs (drops only the unique id)', () => {
    // The paragraph declares xmlns:w14 on its opening tag and its w:pPr USES w14:beforeAutospacing.
    // On split, the tail inherits the w:pPr, so it must also inherit xmlns:w14 — but NOT the unique
    // w14:paraId.
    const nsDoc =
      '<w:p xmlns:w14="http://x" w14:paraId="AAAA"><w:pPr><w:spacing w14:beforeAutospacing="1"/></w:pPr><w:r><w:t>abcd</w:t></w:r></w:p>';
    const session = openDocxSession(docx(nsDoc));
    expect(session.editable).toBe(true);
    const pm = session.projectDoc();
    const split = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: pm.child(0).attrs.semId }, docSchema.text('ab')),
      docSchema.node('paragraph', { semId: null }, docSchema.text('cd')),
    ]);
    expect(session.applyPmDoc(split).committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    expect(savedXml.match(/xmlns:w14="http:\/\/x"/g)?.length).toBe(2); // both halves declare it
    expect(savedXml.match(/w14:paraId="AAAA"/g)?.length).toBe(1); // the unique id only on the head
    expect(savedXml.match(/w14:beforeAutospacing="1"/g)?.length).toBe(2); // both keep the shared pPr
  });

  test('splitting an rsid/paraId paragraph does NOT duplicate the w14:paraId (tail opens fresh)', () => {
    const session = openDocxSession(rsidDoc());
    const doc = session.projectDoc();
    const split = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: doc.child(0).attrs.semId }, docSchema.text('al')),
      docSchema.node('paragraph', { semId: null }, docSchema.text('pha')),
      ...Array.from({ length: doc.childCount - 1 }, (_, i) => doc.child(i + 1)),
    ]);
    expect(session.applyPmDoc(split).committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    // The paraId appears EXACTLY once (the head); the tail opens as a plain <w:p>.
    expect(savedXml.match(/w14:paraId="1F2E3D4C"/g)?.length).toBe(1);
    expect(session.bodyText()).toBe('al\npha\nbeta');
  });
});

describe('run-properties capsule: a styled run (font/color) is editable, rPr preserved (3.1/3.2)', () => {
  const STYLED_RUN =
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:color w:val="FF0000"/><w:sz w:val="28"/></w:rPr><w:t>colored</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>plain</w:t></w:r></w:p>';

  test('a run carrying an unmodeled w:rPr (font/color/size) opens editable', () => {
    const session = openDocxSession(docx(STYLED_RUN));
    expect(session.editable).toBe(true);
    expect(session.readOnlyReason).toBeNull();
  });

  test('editing a styled-run paragraph preserves its w:rPr verbatim through save + reopen', () => {
    const session = openDocxSession(docx(STYLED_RUN));
    const doc = session.projectDoc();
    // Edit WITHIN the styled run, KEEPING its marks (as ProseMirror does for an in-run text edit) —
    // this is the case where the run's rPr must survive (replacing the whole run with plain text is
    // a legitimate formatting reset, handled by withFirstParagraphText and NOT this scenario).
    const firstRun = doc.child(0).child(0);
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', doc.child(0).attrs, docSchema.text('RECOLORED', firstRun.marks)),
      ...Array.from({ length: doc.childCount - 1 }, (_, i) => doc.child(i + 1)),
    ]);
    const res = session.applyPmDoc(edited);
    expect(res.committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    expect(savedXml).toContain('<w:rPr><w:rFonts w:ascii="Arial"/><w:color w:val="FF0000"/><w:sz w:val="28"/></w:rPr>');
    expect(savedXml).toContain('RECOLORED');
    const reopened = openDocxSession(session.save());
    expect(reopened.bodyText()).toBe('RECOLORED\nplain');
    expect(strFromU8(unzipSync(reopened.save())['word/document.xml'])).toContain('<w:color w:val="FF0000"/>');
  });

  test('a run whose rPr has BOTH modeled b/i AND unmodeled color splits cleanly (props not double-kept)', () => {
    // The run carries <w:b/> (modeled) + <w:color/> (unmodeled). It is captured as a full rPr capsule
    // with NO redundant props, so the projection and reverse-mapping agree and Enter splits work.
    const doc = '<w:p><w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>abcd</w:t></w:r></w:p>';
    const session = openDocxSession(docx(doc));
    expect(session.editable).toBe(true);
    const pm = session.projectDoc();
    const firstRun = pm.child(0).child(0);
    const split = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: pm.child(0).attrs.semId }, docSchema.text('ab', firstRun.marks)),
      docSchema.node('paragraph', { semId: null }, docSchema.text('cd', firstRun.marks)),
    ]);
    expect(session.applyPmDoc(split).committed).toBe(true);
    const savedXml = strFromU8(unzipSync(session.save())['word/document.xml']);
    // Both halves keep the full rPr (b + color); the split text round-trips.
    expect(savedXml.match(/<w:color w:val="FF0000"\/>/g)?.length).toBe(2);
    expect(session.bodyText()).toBe('ab\ncd');
  });

  test('a table cell run with an unmodeled w:rPr keeps the table read-only (cells do not capsule)', () => {
    const cellRPr =
      '<w:p><w:r><w:t>intro</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:color w:val="00FF00"/></w:rPr><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    expect(openDocxSession(docx(cellRPr)).editable).toBe(false);
  });
});

describe('document with a table: read-only, verbatim, never flattened', () => {
  test('opens read-only; edits are refused and the save stays byte-identical', () => {
    const before = docx(WITH_TABLE);
    const session = openDocxSession(before);
    expect(session.editable).toBe(false);
    // A structured read-only diagnostic names the blocking capability, QName, story, and lane (4.9).
    expect(session.readOnlyReason).toMatchObject({
      code: 'non-editable-kind',
      blockKind: 'table',
      qname: 'w:tbl',
      missingLane: 'editable-capability',
    });
    expect(session.readOnlyReason?.message).toContain('read-only');

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

describe('selective preservation: ordinary documents are editable, package kept verbatim', () => {
  test('a document with a styles.xml part is EDITABLE and keeps styles on save', () => {
    const withStyles = docx('<w:p><w:r><w:t>hi</w:t></w:r></w:p>', {
      'word/styles.xml': `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/></w:style></w:styles>`,
    });
    const session = openDocxSession(withStyles);
    expect(session.editable).toBe(true);
    // Unedited save re-emits the whole package verbatim, styles.xml included.
    const saved = unzipSync(session.save());
    expect(saved['word/styles.xml']).toBeDefined();
    expect(strFromU8(saved['word/document.xml'])).toContain('hi');
  });

  test('editing a paragraph patches it while styles.xml survives verbatim', () => {
    const withStyles = docx('<w:p><w:r><w:t>hi</w:t></w:r></w:p>', {
      'word/styles.xml': `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/></w:style></w:styles>`,
    });
    const session = openDocxSession(withStyles);
    const edited = withFirstParagraphText(session.projectDoc(), 'CHANGED');
    expect(session.applyPmDoc(edited).committed).toBe(true);
    const saved = unzipSync(session.save());
    expect(strFromU8(saved['word/document.xml'])).toContain('CHANGED');
    expect(saved['word/styles.xml']).toBeDefined(); // preserved through the edit
    // Reopen: the edit survives.
    expect(openDocxSession(session.save()).bodyText()).toBe('CHANGED');
  });

  test('section properties, a w:background, and mc:Ignorable are all editable + preserved', () => {
    const sect = openDocxSession(
      docx('<w:p><w:r><w:t>a</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'),
    );
    expect(sect.editable).toBe(true);
    expect(strFromU8(unzipSync(sect.save())['word/document.xml'])).toContain('<w:sectPr>');

    const bg = openDocxSession(
      zipSync({
        '[Content_Types].xml': strToU8(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" mc:Ignorable="w14"><w:background w:color="FFFF00"/>` +
            '<w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>',
        ),
      }),
    );
    expect(bg.editable).toBe(true);
    expect(strFromU8(unzipSync(bg.save())['word/document.xml'])).toContain('<w:background');
  });

  test('a paragraph with a hyperlink stays read-only (its content is not patchable)', () => {
    expect(openDocxSession(docx('<w:p><w:hyperlink><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>')).editable).toBe(false);
  });

  test('a paragraph carrying a tab stays read-only', () => {
    expect(openDocxSession(docx('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>')).editable).toBe(false);
  });

  test('a paragraph containing an XML comment or PI stays read-only (would be dropped)', () => {
    expect(openDocxSession(docx('<w:p><!--keepme--><w:r><w:t>hi</w:t></w:r></w:p>')).editable).toBe(false);
    expect(openDocxSession(docx('<w:p><?custom data?><w:r><w:t>hi</w:t></w:r></w:p>')).editable).toBe(false);
  });

  test('content BETWEEN paragraphs (comment/bookmark) makes the document read-only', () => {
    // A comment or bookmark between two paragraphs is not inside any block range; a structural
    // edit would splice it away. The document opens read-only so nothing can drop it.
    const withComment = docx('<w:p><w:r><w:t>a</w:t></w:r></w:p><!--between--><w:p><w:r><w:t>b</w:t></w:r></w:p>');
    const session = openDocxSession(withComment);
    expect(session.editable).toBe(false);
    expect(session.save()).toEqual(withComment); // saved verbatim
    const withBookmark = docx(
      '<w:p><w:r><w:t>a</w:t></w:r></w:p><w:bookmarkStart w:id="0" w:name="m"/><w:p><w:r><w:t>b</w:t></w:r></w:p>',
    );
    expect(openDocxSession(withBookmark).editable).toBe(false);
  });

  test('an empty / sectPr-only body opens read-only and saves the original bytes (no throw)', () => {
    const empty = docx('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>');
    const session = openDocxSession(empty);
    expect(session.editable).toBe(false);
    expect(session.save()).toEqual(empty); // returned exactly, never a writer throw
  });
});
