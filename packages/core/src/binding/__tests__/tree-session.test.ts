// Tree-backed session (cutover step 2b).
//
// The headline assertion is the one the legacy path fails: a document containing clipart is
// EDITABLE, and editing it neither loses the drawing nor freezes paragraph structure.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';
import { treeSchema } from '../tree-schema.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const DRAWING =
  '<w:drawing><wp:inline xmlns:wp="urn:wp"><wp:extent cx="914400" cy="914400"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="urn:clip"/></a:graphic></wp:inline></w:drawing>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** `before [clipart] after`, then an ordinary paragraph. */
const CLIPART_BODY =
  '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
  `<w:r>${DRAWING}</w:r>` +
  '<w:r><w:t> after</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>a normal paragraph</w:t></w:r></w:p>';

function open(bytes: Uint8Array): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

/** Edit a paragraph's text through the projection, the way the editor would. */
function retype(session: TreeDocxSession, index: number, text: string) {
  const doc = session.projectDoc();
  const paragraphs: ReturnType<typeof treeSchema.node>[] = [];
  doc.forEach((paragraph, _offset, i) => {
    if (i !== index) {
      paragraphs.push(paragraph);
      return;
    }
    // Keep every non-text child (the clipart atom) exactly where it is; replace only text.
    const inline: ReturnType<typeof treeSchema.text>[] = [];
    let replaced = false;
    paragraph.forEach((child) => {
      if (child.isText && !replaced) {
        inline.push(treeSchema.text(text, child.marks));
        replaced = true;
        return;
      }
      if (child.isText) return; // drop the remaining text; `text` carries the new content
      inline.push(child as never);
    });
    paragraphs.push(treeSchema.node('paragraph', paragraph.attrs, inline as never));
  });
  return session.applyPmDoc(treeSchema.node('doc', null, paragraphs));
}

describe('a clipart document is editable on the tree (cutover step 2b)', () => {
  // The legacy `assessBodyEditability` comparison test was deleted with the legacy parser
  // (phase-4 sweep): a drawing used to freeze structural editing on the byte-range model;
  // the tree session below is the behaviour that replaced it.
  test('the TREE session opens the same document editable', () => {
    const session = open(docx(CLIPART_BODY));
    expect(session.editable).toBe(true);
    expect(session.paragraphIds()).toHaveLength(2);
    expect(session.bodyText()).toBe('before  after\na normal paragraph');
  });

  test('editing the text beside the clipart commits and keeps the drawing', () => {
    const session = open(docx(CLIPART_BODY));
    const result = retype(session, 0, 'BEFORE ');
    expect(result.rejected).toBe(false);
    expect(result.committed).toBe(true);
    expect(session.bodyText()).toContain('BEFORE ');

    // The drawing survives the save, from the tree, with no retained bytes anywhere.
    const reopened = open(session.save());
    expect(reopened.bodyText()).toContain('BEFORE ');
    expect(reopened.paragraphIds()).toHaveLength(2);
    // The drawing is still there after the round trip. Checked through the REOPENED tree
    // rather than the saved bytes, which are deflated and not searchable as text.
    const kinds: string[] = [];
    reopened
      .projectDoc()
      .child(0)
      .forEach((child) => kinds.push(child.isText ? 'text' : child.type.name));
    expect(kinds).toContain('unknownInline');
  });

  test('paragraph structure still works in a document containing clipart', () => {
    const session = open(docx(CLIPART_BODY));
    const doc = session.projectDoc();
    const first = doc.child(0);
    const second = doc.child(1);
    // Split the ordinary paragraph. Under the legacy rules this was refused outright,
    // because one drawing set structuralMutationAllowed to false for the whole document.
    const split = treeSchema.node('doc', null, [
      first,
      treeSchema.node('paragraph', second.attrs, [treeSchema.text('a normal')]),
      treeSchema.node('paragraph', { nodeId: null, props: [] }, [treeSchema.text(' paragraph')]),
    ]);
    const result = session.applyPmDoc(split);
    expect(result.committed).toBe(true);
    expect(session.paragraphIds()).toHaveLength(3);
    expect(session.bodyText()).toBe('before  after\na normal\n paragraph');
  });

  test('deleting the clipart through the projection is refused, not silently applied', () => {
    const session = open(docx(CLIPART_BODY));
    const doc = session.projectDoc();
    const stripped = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', doc.child(0).attrs, [treeSchema.text('before  after')]),
      doc.child(1),
    ]);
    const result = session.applyPmDoc(stripped);
    expect(result.rejected).toBe(true);
    expect(result.reason).toBe('unknown-content-moved');
    // And nothing changed.
    expect(session.revision()).toBe(0);
  });
});

describe('session surface over the tree', () => {
  const simple = () => open(docx('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'));

  test('an unedited projection commits nothing', () => {
    const session = simple();
    const result = session.applyPmDoc(session.projectDoc());
    expect(result).toEqual({ committed: false, rejected: false, opCount: 0 });
    expect(session.revision()).toBe(0);
  });

  test('undo and redo run on the canonical tree', () => {
    const session = simple();
    retype(session, 0, 'Hello world');
    expect(session.bodyText()).toBe('Hello world');
    expect(session.canUndo()).toBe(true);
    session.undo();
    expect(session.bodyText()).toBe('Hello');
    session.redo();
    expect(session.bodyText()).toBe('Hello world');
  });

  test('a composition is one undo step', () => {
    const session = simple();
    session.beginComposition();
    retype(session, 0, 'Helloあ');
    retype(session, 0, 'Hello日本');
    session.endComposition();
    session.undo();
    expect(session.bodyText()).toBe('Hello');
  });

  test('save and reopen preserves an authored underline variant', () => {
    const session = open(
      docx('<w:p><w:r><w:rPr><w:u w:val="double"/></w:rPr><w:t>styled</w:t></w:r></w:p>')
    );
    retype(session, 0, 'restyled');
    const reopened = open(session.save());
    expect(reopened.bodyText()).toBe('restyled');
    const mark = reopened.projectDoc().child(0).child(0).marks[0];
    expect(mark?.attrs.props).toEqual([{ localName: 'u', attributes: { val: 'double' } }]);
  });

  test('subscribers see one change per committed transaction', () => {
    const session = simple();
    const revisions: number[] = [];
    session.subscribe((change) => revisions.push(change.toRevision));
    retype(session, 0, 'a');
    retype(session, 0, 'ab');
    expect(revisions).toEqual([1, 2]);
  });

  test('a malformed package is a typed rejection, not a throw', () => {
    const result = openTreeSession(new Uint8Array([1, 2, 3, 4]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.reason).toBe('string');
  });

  test('reconcile reuses untouched paragraphs after a committed edit', () => {
    const session = open(
      docx('<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>')
    );
    const before = session.projectDoc();
    retype(session, 1, 'two!');
    const after = session.reconcile(before);
    expect(after.child(0)).toBe(before.child(0));
    expect(after.child(1).textContent).toBe('two!');
  });
});

describe('w14 paragraph identity through the session', () => {
  test('open establishes a valid unique paraId on every editable paragraph', () => {
    // The harness declares only xmlns:w — every id here is minted at open, along with
    // the root binding the minted attributes need.
    const session = open(
      docx(
        '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
          '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
          '<w:p><w:r><w:t>two</w:t></w:r></w:p>'
      )
    );
    const anchors = session.paragraphAnchors();
    const ids = session.paragraphIds();
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      const paraId = session.paraIdOf(id);
      expect(paraId).toMatch(/^[0-9A-F]{8}$/);
      expect(session.nodeIdOf(paraId!)).toBe(id);
      expect(session.nodeIdOf(paraId!.toLowerCase())).toBe(id);
    }
    expect(new Set(anchors.nodeByParaId.keys()).size).toBe(3);
  });

  test('save/reopen preserves each paragraph text→paraId pairing', () => {
    const session = open(
      docx('<w:p><w:r><w:t>alpha</w:t></w:r></w:p><w:p><w:r><w:t>beta</w:t></w:r></w:p>')
    );
    const pairing = session.paragraphIds().map((id) => session.paraIdOf(id));
    const reopened = open(session.save());
    expect(reopened.paragraphIds().map((id) => reopened.paraIdOf(id))).toEqual(pairing);
  });

  test('a projection-lane split mints a fresh id for the new paragraph', () => {
    const session = open(docx('<w:p><w:r><w:t>headtail</w:t></w:r></w:p>'));
    const [id] = session.paragraphIds();
    const before = session.paraIdOf(id!);
    session.applyTreeOps([{ op: 'splitParagraph', paragraphId: id!, offset: 4 }]);
    const [head, tail] = session.paragraphIds();
    expect(session.paraIdOf(head!)).toBe(before!);
    const minted = session.paraIdOf(tail!);
    expect(minted).toMatch(/^[0-9A-F]{8}$/);
    expect(minted).not.toBe(before);
  });

  test('paragraphAnchors is reference-stable per revision and fresh after commit/undo', () => {
    const session = open(docx('<w:p><w:r><w:t>hello</w:t></w:r></w:p>'));
    const first = session.paragraphAnchors();
    expect(session.paragraphAnchors()).toBe(first);
    const [id] = session.paragraphIds();
    session.applyTreeOps([{ op: 'splitParagraph', paragraphId: id!, offset: 2 }]);
    const afterSplit = session.paragraphAnchors();
    expect(afterSplit).not.toBe(first);
    expect(afterSplit.nodeByParaId.size).toBe(2);
    session.undo();
    const afterUndo = session.paragraphAnchors();
    expect(afterUndo).not.toBe(afterSplit);
    expect(afterUndo.nodeByParaId.size).toBe(1);
    expect(session.nodeIdOf('no such id')).toBeNull();
    expect(session.paraIdOf('/word/document.xml#nope')).toBeNull();
  });
});

describe('hostile prefix shadowing end to end', () => {
  test('a subtree shadowing w14 neither locks editing nor loses identity', () => {
    // Open-time normalization picks an alias outside the conflicting set, so every
    // paragraph — inside and outside the shadow — is identified, and a split inside
    // the shadowed subtree still commits AND mints.
    const session = open(
      docx(
        '<w:p><w:r><w:t>outside</w:t></w:r></w:p>' +
          '<w:sdt xmlns:w14="urn:evil"><w:sdtContent><w:p><w:r><w:t>inside</w:t></w:r></w:p></w:sdtContent></w:sdt>'
      )
    );
    const [outside, inside] = session.paragraphIds();
    expect(session.paraIdOf(outside!)).toMatch(/^[0-9A-F]{8}$/);
    expect(session.paraIdOf(inside!)).toMatch(/^[0-9A-F]{8}$/);

    const result = session.applyTreeOps([
      { op: 'splitParagraph', paragraphId: inside!, offset: 3 },
    ]);
    expect(result.committed).toBe(true);
    const ids = session.paragraphIds().map((id) => session.paraIdOf(id));
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(id).toMatch(/^[0-9A-F]{8}$/);
    expect(new Set(ids).size).toBe(3);
  });
});
