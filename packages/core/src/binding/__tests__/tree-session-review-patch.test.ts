// Conservative local review patch after one-paragraph text-local edits.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  commentPartNameOf,
  commentsExtendedPartNameOf,
} from '../../store/store/comment-writes.ts';
import { collectReviewItems, revisionItemsOfParagraph } from '../../layout/review-model.ts';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';
import { treeSchema } from '../tree-schema.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (id: string, inner: string) =>
  `<w:ins w:id="${id}" w:author="Ada" w:date="2026-01-01T00:00:00Z">${inner}</w:ins>`;
const delRun = (text: string) =>
  `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const del = (id: string, inner: string) =>
  `<w:del w:id="${id}" w:author="QA" w:date="2026-01-01T00:00:00Z">${inner}</w:del>`;
const cStart = (id: string) => `<w:commentRangeStart w:id="${id}"/>`;
const cEnd = (id: string) =>
  `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;

function docx(body: string, comments?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (comments
          ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (comments) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    );
    files['word/comments.xml'] = strToU8(
      `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${comments}</w:comments>`
    );
  }
  return zipSync(files);
}

function open(bytes: Uint8Array): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

function oracle(session: TreeDocxSession) {
  const pkg = session.currentPackage();
  const part = session.part();
  return collectReviewItems({
    storyPart: part,
    commentsPart: pkg.parts.get(commentPartNameOf(pkg, part.name)),
    commentsExtendedPart: pkg.parts.get(commentsExtendedPartNameOf(pkg, part.name)),
  });
}

/** Edit one paragraph's text through the projection, keeping non-text inline nodes. */
function retype(session: TreeDocxSession, index: number, text: string) {
  const doc = session.projectDoc();
  const paragraphs: ReturnType<typeof treeSchema.node>[] = [];
  doc.forEach((paragraph, _offset, i) => {
    if (i !== index) {
      paragraphs.push(paragraph);
      return;
    }
    const inline: ReturnType<typeof treeSchema.text>[] = [];
    let replaced = false;
    paragraph.forEach((child) => {
      if (child.isText && !replaced) {
        inline.push(treeSchema.text(text, child.marks));
        replaced = true;
        return;
      }
      if (child.isText) return;
      inline.push(child as never);
    });
    paragraphs.push(treeSchema.node('paragraph', paragraph.attrs, inline as never));
  });
  return session.applyPmDoc(treeSchema.node('doc', null, paragraphs));
}

const TWO_PARAGRAPH_TRACKED =
  `<w:p>${run('first ')}${ins('1', run('added'))}</w:p>` +
  `<w:p>${run('second ')}${ins('2', run('kept'))}</w:p>`;

const THREE_PARAGRAPH_TRACKED =
  `<w:p>${run('first ')}${ins('1', run('alpha'))}</w:p>` +
  `<w:p>${run('middle plain')}</w:p>` +
  `<w:p>${run('third ')}${ins('2', run('omega'))}</w:p>`;

const tblPrIns = (id: string, author: string, date: string) =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="${date}"/>`;

const BODY_TABLE_STRUCTURAL =
  `<w:tbl><w:tblPr>${tblPrIns('99', 'Bob', '2026-01-02T00:00:00Z')}</w:tblPr>` +
  `<w:tr><w:tc><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`;

const TRACKED_WITH_UNRELATED_RANGELESS_STRUCTURAL =
  TWO_PARAGRAPH_TRACKED + BODY_TABLE_STRUCTURAL;

const NESTED_TBLPR_COLLISION =
  `<w:p>${ins(
    '1',
    `<w:tbl><w:tblPr>${tblPrIns('99', 'Bob', '2026-01-02T00:00:00Z')}</w:tblPr>` +
      `<w:tr><w:tc><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`
  )}</w:p>` +
  `<w:p>${run('second ')}${ins('2', run('kept'))}</w:p>` +
  BODY_TABLE_STRUCTURAL;

const MIXED_LOCAL_REVISION_ORDER =
  `<w:p>` +
  `<w:pPr><w:rPr><w:ins w:id="6" w:author="QA" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr>` +
  `${del('1', delRun('del'))}` +
  `<w:r><w:rPr><w:b/><w:rPrChange w:id="5" w:author="QA" w:date="2026-01-01T00:00:00Z">` +
  `<w:rPr/></w:rPrChange></w:rPr><w:t>${'x'.repeat(100)}</w:t></w:r>` +
  `</w:p>` +
  `<w:p>${run('second ')}${ins('2', run('kept'))}</w:p>`;

describe('local review patch after one-paragraph text-local edits', () => {
  test('paragraph-local revisions splice in document order, not site order', () => {
    const session = open(docx(MIXED_LOCAL_REVISION_ORDER));
    const part = session.part();
    const paragraphId = session.paragraphIds()[0]!;
    const localKinds = revisionItemsOfParagraph(part, paragraphId).map(
      (item) => item.revisionKind
    );
    expect(localKinds).toEqual(['paragraphMark', 'delete', 'format']);
    const documentOrderKinds = collectReviewItems({ storyPart: part })
      .filter(
        (item) =>
          item.kind === 'revision' &&
          item.ranges.length > 0 &&
          item.ranges[0]!.start.paragraphId === paragraphId
      )
      .map((item) => item.revisionKind);
    expect(documentOrderKinds).toEqual(['delete', 'format', 'paragraphMark']);
    expect(localKinds).not.toEqual(documentOrderKinds);

    session.reviewItems();
    const neighbor = session
      .reviewItems()
      .find((item) => item.kind === 'revision' && item.text === 'kept')!;

    const result = session.applyTreeOps([
      {
        op: 'insertText',
        paragraphId,
        offset: 3,
        text: '!',
        revision: { author: 'QA', date: '2026-01-01T00:00:00Z' },
      },
    ]);
    expect(result.committed).toBe(true);

    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after.find((item) => item === neighbor)).toBe(neighbor);
    const expectedDirty = oracle(session).filter(
      (item) =>
        item.kind === 'revision' &&
        item.ranges.length > 0 &&
        item.ranges[0]!.start.paragraphId === paragraphId
    );
    const actualDirty = after.filter(
      (item) =>
        item.kind === 'revision' &&
        item.ranges.length > 0 &&
        item.ranges[0]!.start.paragraphId === paragraphId
    );
    expect(actualDirty.map((item) => item.revisionKind)).toEqual(
      expectedDirty.map((item) => item.revisionKind)
    );
  });

  test('unrelated range-less structural revisions preserve references on local patch', () => {
    const session = open(docx(TRACKED_WITH_UNRELATED_RANGELESS_STRUCTURAL));
    const before = session.reviewItems();
    const structural = before.find(
      (item) => item.kind === 'revision' && item.revisionKind === 'structural'
    )!;
    expect(structural.ranges).toHaveLength(0);
    const neighbor = before.find(
      (item) => item.kind === 'revision' && item.revisionKind === 'insert' && item.text === 'kept'
    )!;
    const paragraphId = session.paragraphIds()[0]!;

    const result = session.applyTreeOps([
      {
        op: 'insertText',
        paragraphId,
        offset: 11,
        text: '!',
        revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
      },
    ]);
    expect(result.committed).toBe(true);

    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after.find((item) => item === structural)).toBe(structural);
    expect(after.find((item) => item === neighbor)).toBe(neighbor);
  });

  test('range-less local ambiguity falls back instead of patching', () => {
    const session = open(docx(NESTED_TBLPR_COLLISION));
    session.reviewItems();
    const structuralBefore = session
      .reviewItems()
      .find((item) => item.kind === 'revision' && item.revisionKind === 'structural' && item.ranges.length === 0)!;
    const paragraphId = session.paragraphIds()[0]!;

    const result = session.applyTreeOps([
      {
        op: 'insertText',
        paragraphId,
        offset: 0,
        text: 'X',
        revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
      },
    ]);
    expect(result.committed).toBe(true);

    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after.find((item) => item === structuralBefore)).toBeUndefined();
  });

  test('replacing existing local revisions preserves neighbors and matches oracle', () => {
    const session = open(docx(TWO_PARAGRAPH_TRACKED));
    const before = session.reviewItems();
    const neighbor = before[1]!;
    const oldLocal = before[0]!;
    const paragraphId = session.paragraphIds()[0]!;

    const result = session.applyTreeOps([
      {
        op: 'insertText',
        paragraphId,
        offset: 11,
        text: '!',
        revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
      },
    ]);
    expect(result.committed).toBe(true);

    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after[1]).toBe(neighbor);
    expect(after[0]).not.toBe(oldLocal);
    expect(after[0]!.kind).toBe('revision');
    expect(after[0]!.text).toBe('added!');
  });

  test('first tracked revision on a middle paragraph inserts between neighbors', () => {
    const session = open(docx(THREE_PARAGRAPH_TRACKED));
    const before = session.reviewItems();
    expect(before).toHaveLength(2);
    const earlier = before[0]!;
    const later = before[1]!;
    const middleId = session.paragraphIds()[1]!;

    const result = session.applyTreeOps([
      {
        op: 'insertText',
        paragraphId: middleId,
        offset: 'middle plain'.length,
        text: ' tracked',
        revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
      },
    ]);
    expect(result.committed).toBe(true);

    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(earlier);
    expect(after[2]).toBe(later);
    expect(after[1]!.kind).toBe('revision');
  });

  test('tracked/plain edits deep-equal collectReviewItems and preserve other paragraphs', () => {
    const session = open(docx(TWO_PARAGRAPH_TRACKED));
    const before = session.reviewItems();
    expect(before).toHaveLength(2);
    const untouched = before[1]!;

    const result = retype(session, 0, 'FIRST ');
    expect(result.committed).toBe(true);

    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after[1]).toBe(untouched);
  });

  test('comments on an untouched paragraph preserve references', () => {
    const body =
      `<w:p>${cStart('c1')}${run('first')}${cEnd('c1')}</w:p>` +
      `<w:p>${run('second ')}${ins('1', run('tracked'))}</w:p>`;
    const comments =
      `<w:comment w:id="c1" w:author="QA" w:date="D"><w:p>${run('note')}</w:p></w:comment>`;
    const session = open(docx(body, comments));
    const before = session.reviewItems();
    const commentItem = before.find((item) => item.kind === 'comment')!;

    retype(session, 1, 'SECOND ');
    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after.find((item) => item.kind === 'comment')).toBe(commentItem);
  });

  test('a comment on the dirty paragraph falls back to full collectReviewItems', () => {
    const body =
      `<w:p>${cStart('c1')}${run('first ')}${ins('1', run('tracked'))}${cEnd('c1')}</w:p>` +
      `<w:p>${run('second')}</w:p>`;
    const comments =
      `<w:comment w:id="c1" w:author="QA" w:date="D"><w:p>${run('note')}</w:p></w:comment>`;
    const session = open(docx(body, comments));
    session.reviewItems();
    const commentBefore = session.reviewItems().find((item) => item.kind === 'comment')!;

    retype(session, 0, 'FIRST ');
    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after.find((item) => item.kind === 'comment')).not.toBe(commentBefore);
  });

  test('a cross-paragraph revision falls back instead of patching', () => {
    const body =
      `<w:p>${run('start ')}${ins('1', run('span'))}</w:p>` +
      `<w:p>${ins('1', run(' tail'))}${run(' end')}</w:p>`;
    const session = open(docx(body));
    const before = session.reviewItems();
    const revisionBefore = before.find((item) => item.kind === 'revision')!;
    expect(revisionBefore.ranges).toHaveLength(2);

    retype(session, 0, 'START ');
    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after.find((item) => item.kind === 'revision')).not.toBe(revisionBefore);
  });

  test('structural edits fall back and still match the oracle', () => {
    const session = open(docx(TWO_PARAGRAPH_TRACKED));
    session.reviewItems();
    const beforeRefs = session.reviewItems();

    const paragraphId = session.paragraphIds()[0]!;
    session.applyTreeOps([
      {
        op: 'splitParagraph',
        paragraphId,
        offset: 5,
      },
    ]);

    const after = session.reviewItems();
    expect(after).toEqual(oracle(session));
    expect(after.some((item, index) => item === beforeRefs[index])).toBe(false);
  });
});
