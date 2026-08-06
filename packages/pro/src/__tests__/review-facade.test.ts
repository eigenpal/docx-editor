/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review queue as the FACADE publishes it — the six members a sidebar is built on.
//
// What these pin down: the queue is presentation-ready without the host deriving anything
// from the tree, one card covers every site of one decision, accept and reject actually move
// the document, a reply threads under the comment it answers, and a revision the engine
// cannot resolve arrives marked `readOnly` instead of arriving with buttons that would fail.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { paragraphTextOf, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { reviewModule as testReviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

interface DocxParts {
  readonly body: string;
  readonly comments?: string;
  /** Default-header content; wires the part, its relationship and the section reference. */
  readonly header?: string;
}

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docx({ body, comments, header }: DocxParts): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (comments ? `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>` : '') +
        (header
          ? `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
          : '') +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w15="${W15}" xmlns:r="${R}"><w:body>${body}` +
        (header ? `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>` : '') +
        `</w:body></w:document>`
    ),
  };
  const documentRels: string[] = [];
  if (comments) {
    documentRels.push(`<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>`);
    files['word/comments.xml'] = strToU8(
      `<w:comments xmlns:w="${W}" xmlns:w15="${W15}">${comments}</w:comments>`
    );
  }
  if (header) {
    documentRels.push(`<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>`);
    files['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`);
  }
  if (documentRels.length > 0) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${documentRels.join('')}</Relationships>`
    );
  }
  return zipSync(files);
}

/** The story's first paragraph id. */
function paragraphIdOf(editor: DocxEditorInstance): string {
  const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
  return fragment.paragraphId;
}

/** The document as the CANONICAL tree holds it, not as the view happens to paint it. */
function bodyTextOf(editor: DocxEditorInstance): string {
  return editor.surface!.session.bodyText();
}

function mount(parts: DocxParts): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(parts),
    author: 'Grace Hopper',
    modules: [testReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const INSERTION =
  `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
  `<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">` +
  `<w:r><w:t>added text</w:t></w:r></w:ins></w:p>`;

const DELETION =
  `<w:p><w:del w:id="2" w:author="Alan Turing" w:date="2026-02-03T04:05:06Z">` +
  `<w:r><w:delText>struck out</w:delText></w:r></w:del></w:p>`;

const TWO_ROW_TABLE =
  `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>` +
  `<w:tr><w:tc><w:p><w:r><w:t>first</w:t></w:r></w:p></w:tc></w:tr>` +
  `<w:tr><w:tc><w:p><w:r><w:t>second</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

function tableRows(editor: DocxEditorInstance) {
  const table = editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .find((fragment) => fragment.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('expected a table fragment');
  return table.rows;
}

function tableRowCount(editor: DocxEditorInstance): number {
  return tableRows(editor).length;
}

/** Narrow to the revision arm — the placement union needs the kind before its fields. */
function rev(placement: { kind: string } | undefined) {
  if (!placement || placement.kind !== 'revision') throw new Error('expected a revision card');
  return placement as import('@docx-editor.dev/core/contracts/editor').ReviewRevisionPlacement;
}

describe('the review queue the facade publishes', () => {
  test('a card arrives presentation-ready, so no host derives it from the tree', () => {
    const editor = mount({ body: INSERTION });
    const [card] = editor.getReviewItems();
    expect(card).toBeDefined();
    expect(card!.kind).toBe('revision');
    expect(rev(card).revisionKind).toBe('insert');
    expect(card!.author).toBe('Ada Lovelace');
    // Initials come from the name for a revision: `CT_TrackChange` has no `@w:initials`.
    expect(card!.initials).toBe('AL');
    expect(card!.date).toBe('2026-01-02T03:04:05Z');
    expect(card!.text).toBe('added text');
    expect(card!.readOnly).toBe(false);
    // The anchor comes from LAYOUT, not from painted DOM.
    expect(card!.anchorY).toBeGreaterThanOrEqual(0);
    expect(card!.pageIndex).toBe(0);
  });

  test('accepting keeps the inserted words and drops the tracking', () => {
    const editor = mount({ body: INSERTION });
    const [card] = editor.getReviewItems();
    expect(editor.acceptReviewItem(card!.key)).toEqual({ ok: true, changed: true });
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(bodyTextOf(editor)).toContain('added text');
  });

  test('rejecting an insertion removes the words it proposed', () => {
    const editor = mount({ body: INSERTION });
    const [card] = editor.getReviewItems();
    expect(editor.rejectReviewItem(card!.key)).toEqual({ ok: true, changed: true });
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(bodyTextOf(editor)).not.toContain('added text');
  });

  test('rejecting a deletion brings the struck text back as live content', () => {
    const editor = mount({ body: DELETION });
    const [card] = editor.getReviewItems();
    expect(rev(card).revisionKind).toBe('delete');
    expect(editor.rejectReviewItem(card!.key)).toEqual({ ok: true, changed: true });
    expect(bodyTextOf(editor)).toContain('struck out');
  });

  test('an unknown key is refused with a reason rather than silently ignored', () => {
    const editor = mount({ body: INSERTION });
    const result = editor.rejectReviewItem('revision-nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('notFound');
  });

  test('the revision counter moves on a resolve, so a subscriber re-derives once', () => {
    const editor = mount({ body: INSERTION });
    const before = editor.getReviewRevision();
    editor.acceptReviewItem(editor.getReviewItems()[0]!.key);
    expect(editor.getReviewRevision()).not.toBe(before);
  });
});

describe('tracked table rows', () => {
  test('sequential suggesting keystrokes replace table-cell text beyond one character', () => {
    const editor = mount({ body: TWO_ROW_TABLE });
    editor.setEditingMode('suggesting');
    const firstParagraph = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraph, offset: 0 },
      head: { paragraphId: firstParagraph, offset: 5 },
    });

    editor.surface!.type('s');
    expect(editor.surface!.state().selection.head).toEqual({
      paragraphId: firstParagraph,
      offset: 6,
    });
    editor.surface!.type('e');

    expect(editor.surface!.state().lastRejection).toBeNull();
    expect(editor.surface!.state().selection.head).toEqual({
      paragraphId: firstParagraph,
      offset: 7,
    });
    const replacement = editor
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.revisionKind === 'replace');
    expect(rev(replacement).replacedText).toBe('first');
    expect(replacement?.text).toBe('se');
  });

  test('inserting a row paints immediately, opens one review card, and keeps typing', () => {
    const editor = mount({ body: TWO_ROW_TABLE });
    editor.setEditingMode('suggesting');
    const firstParagraph = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraph, offset: 0 },
      head: { paragraphId: firstParagraph, offset: 0 },
    });

    expect(editor.exec({ type: 'insertRow', where: 'below' }).ok).toBe(true);
    expect(tableRowCount(editor)).toBe(3);
    expect(tableRows(editor).filter((row) => row.revisionKind === 'insert')).toHaveLength(1);
    expect(editor.isReviewPaneOpen()).toBe(true);
    const rowCard = editor
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.revisionKind === 'structural');
    expect(rowCard).toBeDefined();
    expect(rowCard?.readOnly).toBe(false);

    const insertedParagraph = editor.surface!.state().selection.head.paragraphId;
    editor.surface!.type('A');
    expect(editor.surface!.state().selection.head).toEqual({
      paragraphId: insertedParagraph,
      offset: 1,
    });
    expect(paragraphTextOf(editor.surface!.session.part(), insertedParagraph)).toBe('A');
    editor.surface!.type('B');
    expect(editor.surface!.state().lastRejection).toBeNull();
    expect(paragraphTextOf(editor.surface!.session.part(), insertedParagraph)).toBe('AB');
    expect(tableRowCount(editor)).toBe(3);
  });

  test('deleting a row stays visible as a proposal until accepted', () => {
    const editor = mount({ body: TWO_ROW_TABLE });
    editor.setEditingMode('suggesting');
    const firstParagraph = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: firstParagraph, offset: 0 },
      head: { paragraphId: firstParagraph, offset: 0 },
    });

    expect(editor.exec({ type: 'deleteRow' }).ok).toBe(true);
    expect(tableRowCount(editor)).toBe(2);
    expect(tableRows(editor).filter((row) => row.revisionKind === 'delete')).toHaveLength(1);
    const rowCard = editor
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.revisionKind === 'structural');
    expect(rowCard).toBeDefined();
    expect(rowCard?.readOnly).toBe(false);
    expect(editor.acceptReviewItem(rowCard!.key).ok).toBe(true);
    expect(tableRowCount(editor)).toBe(1);
  });
});

describe('comments in the queue', () => {
  const COMMENTED_BODY =
    `<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>commented words</w:t></w:r>` +
    `<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>`;
  const COMMENTS =
    `<w:comment w:id="7" w:author="Ada Lovelace" w:initials="AL" w:date="2026-03-04T05:06:07Z">` +
    `<w:p><w:r><w:t>Is this the right clause?</w:t></w:r></w:p></w:comment>`;

  test('a comment card carries its body text and its author initials', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    expect(card!.kind).toBe('comment');
    expect(card!.author).toBe('Ada Lovelace');
    // `@w:initials` when the file carries one, rather than re-deriving from the name.
    expect(card!.initials).toBe('AL');
    expect(card!.text).toBe('Is this the right clause?');
    // A comment is never accept/reject — there is nothing in the document to resolve.
    expect(card!.readOnly).toBe(false);
    expect(card!.replyIds).toEqual([]);
  });

  test('a reply threads under the comment it answers instead of becoming a second card', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    expect(editor.replyToReviewItem(card!.key, 'Yes, checked against the schedule.')).toEqual({
      ok: true,
      changed: true,
    });

    const items = editor.getReviewItems();
    const roots = items.filter((item) => item.kind === 'comment' && item.parentId === undefined);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.replyIds).toHaveLength(1);

    const reply = items.find((item) => item.kind === 'comment' && item.parentId !== undefined);
    expect(reply?.text).toBe('Yes, checked against the schedule.');
    // The AMBIENT author, from `DocxEditorConfig.author` — `CT_Comment` requires one.
    expect(reply?.author).toBe('Grace Hopper');
  });

  test('deleting a comment takes its record, its markers and its card away', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    expect(editor.deleteReviewItem(card!.key)).toEqual({ ok: true, changed: true });
    expect(editor.getReviewItems()).toHaveLength(0);
    // The WORDS stay. Deleting a remark is not deleting the text it was about — that is the
    // whole difference between this and selecting the range and pressing Delete.
    expect(bodyTextOf(editor)).toContain('commented words');
  });

  test('deleting a comment takes its replies with it, and one undo brings the thread back', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    expect(editor.replyToReviewItem(card!.key, 'Checked.').ok).toBe(true);
    expect(editor.getReviewItems()).toHaveLength(2);

    const root = editor
      .getReviewItems()
      .find((item) => item.kind === 'comment' && item.parentId === undefined)!;
    expect(editor.deleteReviewItem(root.key).ok).toBe(true);
    // A reply whose parent is gone has nothing left to answer, so the CONVERSATION goes —
    // the same rule resolving a thread follows.
    expect(editor.getReviewItems()).toHaveLength(0);

    editor.surface!.undo();
    expect(editor.getReviewItems()).toHaveLength(2);
  });

  test('deleting a comment emits a change, so a subscribed rail re-derives', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    const seen: number[] = [];
    editor.on('change', () => seen.push(editor.getReviewItems().length));
    expect(editor.deleteReviewItem(card!.key).ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(0);
  });

  test('deleting a tracked change discards the suggestion, like rejecting it', () => {
    const editor = mount({ body: INSERTION });
    const [card] = editor.getReviewItems();
    expect(editor.deleteReviewItem(card!.key)).toEqual({ ok: true, changed: true });
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(bodyTextOf(editor)).not.toContain('added text');
  });

  test('deleting an item the queue does not hold is refused rather than silently ignored', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const result = editor.deleteReviewItem('comment-nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('notFound');
  });

  test('a reply to a tracked change nests in that change, not beside it', () => {
    const editor = mount({ body: INSERTION });
    const [change] = editor.getReviewItems();
    expect(change!.kind).toBe('revision');
    expect(editor.replyToReviewItem(change!.key, 'Why this wording?').ok).toBe(true);

    const items = editor.getReviewItems();
    const revision = items.find((item) => item.kind === 'revision')!;
    const reply = items.find((item) => item.kind === 'comment')!;
    // OOXML gives `w:ins` no body, so the answer is a comment over the change's own range.
    // The RANGE is the only record of the link, and without reading it the reply came back
    // as an independent card floating beside the change it answered.
    expect(revision.replyIds).toEqual([reply.id]);
    expect(reply.kind === 'comment' && reply.parentRevisionId).toBe(revision.id);
    expect(reply.text).toBe('Why this wording?');
  });

  test('a SECOND reply to a change is listed too, not swallowed by the first', () => {
    const editor = mount({ body: INSERTION });
    const [change] = editor.getReviewItems();
    expect(editor.replyToReviewItem(change!.key, 'first').ok).toBe(true);
    const revision = editor.getReviewItems().find((item) => item.kind === 'revision')!;
    expect(editor.replyToReviewItem(revision.key, 'second').ok).toBe(true);

    const items = editor.getReviewItems();
    const after = items.find((item) => item.kind === 'revision')!;
    // BOTH. The second reply is written over the same span as the first, so the coincident
    // rule threads it under the first comment — and a card that renders `replyIds` flat
    // showed only the head. The reader's second answer existed in `comments.xml` and appeared
    // nowhere on screen.
    expect(after.replyIds).toHaveLength(2);
    const texts = after.replyIds.map((id) => items.find((item) => item.id === id)?.text);
    expect(texts).toEqual(['first', 'second']);
    // Neither is a root, so the rail cannot draw a second card beside the change either.
    for (const id of after.replyIds) {
      const reply = items.find((item) => item.id === id)!;
      expect(reply.kind === 'comment' && reply.parentRevisionId).toBe(after.id);
    }
  });

  test('a keystroke never leaves a comment pointing at a change the queue no longer lists', () => {
    const editor = mount({ body: INSERTION });
    const [change] = editor.getReviewItems();
    expect(editor.replyToReviewItem(change!.key, 'Noted.').ok).toBe(true);

    // A keystroke in the same paragraph takes the session's LOCAL review patch, which
    // re-derives that paragraph's revisions at their new offsets. The comment keeps its
    // cached range, so the spans stop matching — and a link that was only ever added, never
    // cleared, left the comment naming a change that no longer claims it. The rail hides such
    // a comment as a reply and no card renders it, so it disappeared until the next full
    // re-derivation.
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 0 },
      head: { paragraphId: paragraphIdOf(editor), offset: 0 },
    });
    editor.surface!.insertPlainText('x');

    const items = editor.getReviewItems();
    const revisionIds = new Set(items.filter((i) => i.kind === 'revision').map((i) => i.id));
    for (const item of items) {
      if (item.kind !== 'comment' || item.parentRevisionId === undefined) continue;
      expect(revisionIds.has(item.parentRevisionId)).toBe(true);
    }
    // And the comment is still reachable: either nested in a change, or a card of its own.
    const comment = items.find((item) => item.kind === 'comment')!;
    const nested = items.some((i) => i.kind === 'revision' && i.replyIds.includes(comment.id));
    const isRoot = comment.kind === 'comment' && comment.parentRevisionId === undefined;
    expect(nested || isRoot).toBe(true);
  });

  test('a card dismissed without moving the caret reopens when it is clicked again', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    const seen: (string | null)[] = [];
    editor.on('selectionChange', () =>
      seen.push(editor.getReviewItems().find((item) => item.isActive)?.key ?? null)
    );

    editor.setActiveReviewItem(card!.key);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);

    // Dismissing leaves the caret INSIDE the range — the rail's reply-box Cancel does exactly
    // this. So putting the caret back at the range start moves nothing.
    editor.setActiveReviewItem(null);
    expect(editor.getReviewItems()[0]!.isActive).toBe(false);

    editor.setActiveReviewItem(card!.key);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);
    // PUSH, not pull. The engine reopening the card is no use if nobody is told: the surface
    // stays quiet when the caret does not move, so without an explicit emit the rail never
    // re-rendered and the reader was left clicking a card that would not open.
    expect(seen[seen.length - 1]).toBe(card!.key);
  });

  test('deleting one comment leaves a different open card open', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [first] = editor.getReviewItems();
    // Open the card the reader is working in. `deleteReviewItem` used to dismiss whatever the
    // caret was in rather than the card it was deleting, and the delete button keeps the
    // caret — so removing a comment further down closed this one and lost its reply draft.
    editor.setActiveReviewItem(first!.key);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);

    expect(editor.deleteReviewItem('comment-does-not-exist').ok).toBe(false);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);
  });

  test('a comment answering a change the query excludes goes back to being a root card', () => {
    // A tracked FORMATTING change anchors on exactly the run it decorates, which is the same
    // span a comment on that word covers — and the rail hides `format` cards by default.
    const FORMATTED =
      `<w:p><w:commentRangeStart w:id="7"/>` +
      `<w:r><w:rPr><w:b/><w:rPrChange w:id="9" w:author="Ada Lovelace" ` +
      `w:date="2026-03-04T05:06:07Z"><w:rPr/></w:rPrChange></w:rPr><w:t>commented words</w:t></w:r>` +
      `<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>`;
    const editor = mount({
      body: FORMATTED,
      comments:
        `<w:comment w:id="7" w:author="Ada Lovelace" w:initials="AL" ` +
        `w:date="2026-03-04T05:06:07Z"><w:p><w:r><w:t>Is this the right clause?</w:t></w:r>` +
        `</w:p></w:comment>`,
    });

    const linked = editor.getReviewItems().find((item) => item.kind === 'comment')!;
    expect(linked.kind === 'comment' && linked.parentRevisionId).toBeDefined();

    // With the format card filtered out, publishing the link would leave the comment as a
    // reply to a card nobody draws — the rail skips replies, so it would vanish outright.
    const filtered = editor.getReviewItems({ excludeRevisionKinds: ['format', 'structural'] });
    const comment = filtered.find((item) => item.kind === 'comment')!;
    expect(comment.kind === 'comment' && comment.parentRevisionId).toBeUndefined();
  });

  test('the caret in a change that has been answered opens the change, not the reply', () => {
    const editor = mount({ body: INSERTION });
    const [change] = editor.getReviewItems();
    expect(editor.replyToReviewItem(change!.key, 'Noted.').ok).toBe(true);
    editor.setActiveReviewItem(editor.getReviewItems().find((i) => i.kind === 'revision')!.key);

    const items = editor.getReviewItems();
    // The reply covers exactly the change's characters, so it wins the innermost test. It has
    // no card of its own, so resolving to it would open an item nothing on screen draws.
    expect(items.find((item) => item.kind === 'revision')!.isActive).toBe(true);
    expect(items.find((item) => item.kind === 'comment')!.isActive).toBe(false);
  });

  test('an ordinary comment on other words is not read as answering a change', () => {
    const editor = mount({
      body: `${INSERTION}${COMMENTED_BODY}`,
      comments: COMMENTS,
    });
    const comment = editor.getReviewItems().find((item) => item.kind === 'comment')!;
    const revision = editor.getReviewItems().find((item) => item.kind === 'revision')!;
    // Different characters, so there is no evidence of a link and none is invented.
    expect(revision.replyIds).toEqual([]);
    expect(comment.kind === 'comment' && comment.parentRevisionId).toBeUndefined();
  });

  test('a reply keeps its spaces through a save and reopen', async () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    const written = 'Agreed, keeping this.';
    expect(editor.replyToReviewItem(card!.key, written).ok).toBe(true);

    // The in-memory tree holds the string verbatim either way; XML is where it collapses,
    // so only a ROUND TRIP can catch a missing `xml:space="preserve"`.
    const saved = new Uint8Array(await editor.save());
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: saved,
      modules: [testReviewModule()],
    });
    const reply = reopened
      .getReviewItems()
      .find((item) => item.kind === 'comment' && item.parentId !== undefined);
    expect(reply?.text).toBe(written);
  });

  test('replying does not steal the open card from the thread it belongs to', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    editor.setActiveReviewItem(card!.key);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);

    expect(editor.replyToReviewItem(card!.key, 'first reply').ok).toBe(true);

    // The reply is anchored over its parent's range, so both cover the caret and the reply —
    // being newer — wins the innermost test. It has no card of its own, so without resolving
    // to the thread root the reply box vanished from the comment that was just replied to.
    const root = editor
      .getReviewItems()
      .find((item) => item.kind === 'comment' && item.parentId === undefined);
    expect(root?.isActive).toBe(true);
    const reply = editor
      .getReviewItems()
      .find((item) => item.kind === 'comment' && item.parentId !== undefined);
    expect(reply?.isActive).toBe(false);
  });

  test('a reply with no author anywhere is refused rather than written as an empty attribute', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx({ body: COMMENTED_BODY, comments: COMMENTS }),
      modules: [testReviewModule()],
    });
    const [card] = editor.getReviewItems();
    const result = editor.replyToReviewItem(card!.key, 'anonymous');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalidArgs');
  });

  // PUSH, not pull. `getReviewRevision()` moving proves only that a re-derivation WOULD see
  // the reply; it cannot see that nobody was told to re-derive. A rail subscribes through
  // `useSyncExternalStore` on this event, so with no emit the reply stayed invisible until an
  // unrelated click moved the caret and fired `selectionChange` by accident.
  test('replying emits a change, so a subscribed rail re-derives without another gesture', () => {
    const editor = mount({ body: COMMENTED_BODY, comments: COMMENTS });
    const [card] = editor.getReviewItems();
    const seen: number[] = [];
    editor.on('change', () => seen.push(editor.getReviewItems().length));

    expect(editor.replyToReviewItem(card!.key, 'Yes, checked.').ok).toBe(true);

    expect(seen).toHaveLength(1);
    // The handler must already see the reply: an emit that fires before the write lands is
    // the same freeze one notification later.
    expect(seen[0]).toBe(2);
  });

  test('a refused reply emits nothing — there is no change to report', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx({ body: COMMENTED_BODY, comments: COMMENTS }),
      modules: [testReviewModule()],
    });
    const [card] = editor.getReviewItems();
    let emits = 0;
    editor.on('change', () => {
      emits += 1;
    });
    // No author anywhere, so `CT_Comment` cannot be satisfied and nothing is written.
    expect(editor.replyToReviewItem(card!.key, 'anonymous').ok).toBe(false);
    expect(emits).toBe(0);
  });

  test('replying to a REVISION comments on its range — `w:ins` has no thread of its own', () => {
    const editor = mount({ body: INSERTION });
    const [card] = editor.getReviewItems();
    expect(editor.replyToReviewItem(card!.key, 'Why this wording?').ok).toBe(true);
    const comments = editor.getReviewItems().filter((item) => item.kind === 'comment');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toBe('Why this wording?');
  });
});

describe('commenting on a selection', () => {
  const PARAGRAPH = `<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>`;

  function select(editor: DocxEditorInstance, from: number, to: number): void {
    const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    editor.surface!.setSelection({
      anchor: { paragraphId: fragment.paragraphId, offset: from },
      head: { paragraphId: fragment.paragraphId, offset: to },
    });
  }

  test('a collapsed caret gets no affordance and no comment', () => {
    const editor = mount({ body: PARAGRAPH });
    select(editor, 3, 3);
    expect(editor.getSelectionPlacement()).toBeNull();
    const result = editor.addComment('nothing to point at');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalidArgs');
  });

  test('a range gets an anchor and commits a comment over exactly those words', () => {
    const editor = mount({ body: PARAGRAPH });
    select(editor, 6, 10);
    expect(editor.getSelectionPlacement()?.anchorY).toBeGreaterThanOrEqual(0);
    expect(editor.addComment('why this word?')).toEqual({ ok: true, changed: true });

    const [card] = editor.getReviewItems();
    expect(card!.kind).toBe('comment');
    expect(card!.text).toBe('why this word?');
    expect(card!.author).toBe('Grace Hopper');
    const range = (card!.item as { range: { start: { offset: number }; end: { offset: number } } })
      .range;
    expect([range.start.offset, range.end.offset]).toEqual([6, 10]);
  });

  // The same emit `replyToReviewItem` owes, on the same lane. It only LOOKED right in the
  // packaged compose box, which returns focus to the document afterwards and so moved the
  // caret — a host that composes its own box got nothing.
  test('adding a comment emits a change', () => {
    const editor = mount({ body: PARAGRAPH });
    select(editor, 6, 10);
    let emits = 0;
    editor.on('change', () => {
      emits += 1;
    });
    expect(editor.addComment('why this word?').ok).toBe(true);
    expect(emits).toBe(1);
  });

  test('a backwards drag anchors the same range as a forwards one', () => {
    const editor = mount({ body: PARAGRAPH });
    // Head before anchor: the user swept right to left, which is not document order.
    select(editor, 10, 6);
    expect(editor.addComment('either direction').ok).toBe(true);
    const range = (
      editor.getReviewItems()[0]!.item as {
        range: { start: { offset: number }; end: { offset: number } };
      }
    ).range;
    expect([range.start.offset, range.end.offset]).toEqual([6, 10]);
  });
});

describe('suggesting mode', () => {
  const PLAIN = `<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>`;

  function caretAt(editor: DocxEditorInstance, offset: number): void {
    const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    editor.surface!.setSelection({
      anchor: { paragraphId: fragment.paragraphId, offset },
      head: { paragraphId: fragment.paragraphId, offset },
    });
  }

  test('typing becomes a tracked insertion attributed to the ambient author', () => {
    const editor = mount({ body: PLAIN });
    expect(editor.getEditingMode()).toBe('editing');
    expect(editor.setEditingMode('suggesting')).toEqual({ ok: true, changed: false });

    caretAt(editor, 5);
    editor.surface!.type('X');

    const [card] = editor.getReviewItems();
    expect(card?.kind).toBe('revision');
    expect(rev(card).revisionKind).toBe('insert');
    expect(card?.author).toBe('Grace Hopper');
    expect(card?.text).toBe('X');
    // The words are in the document either way; what changed is that this one is a proposal.
    expect(bodyTextOf(editor)).toContain('alphaX');
  });

  test('deleting keeps the words and offers them back as a proposal', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 0 },
      head: { paragraphId: paragraphIdOf(editor), offset: 5 },
    });
    editor.surface!.deleteBackward();

    const [card] = editor.getReviewItems();
    expect(rev(card).revisionKind).toBe('delete');
    expect(card?.text).toBe('alpha');
    // Rejecting the proposal has to put them back, which is only possible because the
    // deletion kept them.
    expect(editor.rejectReviewItem(card!.key).ok).toBe(true);
    expect(bodyTextOf(editor)).toContain('alpha beta');
  });

  test('backspacing through a word strikes it one character at a time, as ONE proposal', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    // Caret after "alpha", then three Backspaces.
    caretAt(editor, 5);
    editor.surface!.deleteBackward();
    editor.surface!.deleteBackward();
    editor.surface!.deleteBackward();

    const cards = editor.getReviewItems();
    // One decision, not three: the ids coalesce, so one Accept resolves the run.
    expect(cards).toHaveLength(1);
    expect(rev(cards[0]).revisionKind).toBe('delete');
    expect(cards[0]!.text).toBe('pha');
    // Nothing was actually removed — that is what makes rejecting possible.
    expect(bodyTextOf(editor)).toContain('alpha beta');
  });

  test('a MID-SENTENCE replacement is one card too, and reads in Word order', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    // "alpha beta": replace "ha be" — a selection that starts inside a run, which is where
    // the insertion used to land BEFORE the struck words and split the pair into two cards.
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 3 },
      head: { paragraphId: paragraphIdOf(editor), offset: 8 },
    });
    editor.surface!.type('XX');

    const cards = editor.getReviewItems();
    expect(cards).toHaveLength(1);
    expect(rev(cards[0]).revisionKind).toBe('replace');
    expect(rev(cards[0]).replacedText).toBe('ha be');
    expect(cards[0]!.text).toBe('XX');
    // Struck words first, replacement after — the order the sentence reads in.
    const body = editor.surface!.session.bodyText();
    expect(body.indexOf('ha be')).toBeLessThan(body.indexOf('XX'));
  });

  test('a replacement over an endnote mark is still ONE card', () => {
    // The struck text crosses a run that holds an `w:endnoteReference` and no text, so the
    // deletion cannot be one `w:del` — it becomes several. That is a fact about the markup,
    // not about the edit: the user selected once and typed once, and Word shows one card.
    const editor = mount({
      body:
        `<w:p><w:r><w:t xml:space="preserve">First endnote reference</w:t></w:r>` +
        `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr>` +
        `<w:endnoteReference w:id="1"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> and second endnote</w:t></w:r></w:p>`,
    });
    editor.setEditingMode('suggesting');
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 19 },
      head: { paragraphId: paragraphIdOf(editor), offset: 39 },
    });
    // Character by character, the way it is actually typed.
    for (const character of 'note') editor.surface!.type(character);

    const cards = editor.getReviewItems();
    expect(cards).toHaveLength(1);
    expect(rev(cards[0]).revisionKind).toBe('replace');
    // The reference measures ONE model unit, exactly as `segmentsOf` counts it, so [19, 39)
    // is "ence" + the reference + " and second end". Counting it as nothing shifted every
    // offset past it by one and struck a character the user had not selected.
    expect(rev(cards[0]).replacedText).toBe('ence and second end');
    expect(cards[0]!.text).toBe('note');
  });

  test('accepting a replacement that spans several elements resolves all of them', () => {
    const editor = mount({
      body:
        `<w:p><w:r><w:t xml:space="preserve">First endnote reference</w:t></w:r>` +
        `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr>` +
        `<w:endnoteReference w:id="1"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> and second endnote</w:t></w:r></w:p>`,
    });
    editor.setEditingMode('suggesting');
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 19 },
      head: { paragraphId: paragraphIdOf(editor), offset: 39 },
    });
    editor.surface!.type('note');

    expect(editor.acceptReviewItem(editor.getReviewItems()[0]!.key).ok).toBe(true);
    // Nothing left pending: every `w:del` the one edit produced is resolved, not just the
    // first. The struck words are gone and "note" took their place \u2014 the endnote reference
    // among them, because the selection covered the one model unit it occupies and Word
    // deletes a note whose mark a deletion runs through.
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(bodyTextOf(editor)).toBe('First endnote refernotenote');
  });

  test('typing over a selection is ONE card: replaced x with y', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 0 },
      head: { paragraphId: paragraphIdOf(editor), offset: 5 },
    });
    editor.surface!.type('omega');

    const cards = editor.getReviewItems();
    expect(cards).toHaveLength(1);
    expect(rev(cards[0]).revisionKind).toBe('replace');
    expect(rev(cards[0]).replacedText).toBe('alpha');
    expect(cards[0]!.text).toBe('omega');
  });

  test('accepting a replacement resolves BOTH halves in one step', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 0 },
      head: { paragraphId: paragraphIdOf(editor), offset: 5 },
    });
    editor.surface!.type('omega');

    expect(editor.acceptReviewItem(editor.getReviewItems()[0]!.key).ok).toBe(true);
    // Nothing left pending, and the document reads as the replacement intended.
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(bodyTextOf(editor)).toBe('omega beta');
  });

  test('rejecting a replacement puts the original words back', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 0 },
      head: { paragraphId: paragraphIdOf(editor), offset: 5 },
    });
    editor.surface!.type('omega');

    expect(editor.rejectReviewItem(editor.getReviewItems()[0]!.key).ok).toBe(true);
    expect(editor.getReviewItems()).toHaveLength(0);
    expect(bodyTextOf(editor)).toBe('alpha beta');
  });

  test('a multi-paragraph delete keeps the boundary rather than destroying it', () => {
    const editor = mount({
      body: `<w:p><w:r><w:t>first para</w:t></w:r></w:p><w:p><w:r><w:t>second para</w:t></w:r></w:p>`,
    });
    editor.setEditingMode('suggesting');
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 5 },
      head: { paragraphId: ids[1]!, offset: 6 },
    });
    editor.surface!.deleteBackward();

    // Two paragraphs still, and the boundary between them is now a PROPOSAL: the text is
    // struck and the paragraph mark carries `w:del`. Joining them outright made reject
    // restore the words and not the boundary — the original was unrecoverable.
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
    const kinds = editor.getReviewItems().map((item) => rev(item).revisionKind);
    expect(kinds).toContain('delete');
    expect(kinds).toContain('paragraphMark');

    // And rejecting puts the document back exactly as it was.
    for (const item of editor.getReviewItems()) editor.rejectReviewItem(item.key);
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
    expect(editor.surface!.session.bodyText()).toContain('first para');
    expect(editor.surface!.session.bodyText()).toContain('second para');
  });

  test('Enter proposes the paragraph break instead of just making one', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    const paragraphId = paragraphIdOf(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    editor.surface!.splitParagraph();

    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
    const mark = editor
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.revisionKind === 'paragraphMark');
    expect(mark).toBeDefined();
    expect(mark!.author).toBe('Grace Hopper');

    // Rejecting the proposed mark runs the paragraphs back together — §17.13.5's rule, and
    // the reason the mark goes on the FIRST paragraph.
    expect(editor.rejectReviewItem(mark!.key).ok).toBe(true);
    expect(editor.surface!.session.paragraphIds()).toHaveLength(1);
  });

  test("the caret at the break opens the Enter's own card", () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    const paragraphId = paragraphIdOf(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    editor.surface!.splitParagraph();

    // The mark is the PILCROW, at the end of the first paragraph — not at offset 0 where
    // its `w:pPr` is written. Anchored at 0, the card never opened at the break that made
    // it and activating it threw the caret to the paragraph start.
    const first = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: first, offset: 5 },
      head: { paragraphId: first, offset: 5 },
    });
    const active = editor.getReviewItems().find((item) => item.isActive);
    expect(rev(active).revisionKind).toBe('paragraphMark');
  });

  test('a run of Enters is ONE decision, not one card per press', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    for (const offset of [5, 4, 3]) {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset },
      });
      editor.surface!.splitParagraph();
    }
    const marks = editor
      .getReviewItems()
      .filter((item) => item.kind === 'revision' && item.revisionKind === 'paragraphMark');
    expect(marks).toHaveLength(1);
  });

  test('back in editing mode an edit is an ordinary edit again', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('suggesting');
    caretAt(editor, 5);
    editor.surface!.type('X');
    expect(editor.getReviewItems()).toHaveLength(1);

    editor.setEditingMode('editing');
    caretAt(editor, 0);
    editor.surface!.type('Y');
    // Still one: the second keystroke proposed nothing.
    expect(editor.getReviewItems()).toHaveLength(1);
  });

  test('viewing refuses EVERY surface write, not just the typing ones', () => {
    const editor = mount({ body: PLAIN });
    const before = bodyTextOf(editor);
    editor.setEditingMode('viewing');
    // Gating one function was not enough: breaks, lists, indent, section properties and
    // formatting are their own lanes over the same session, and each reached it directly —
    // so a read-only document still took Ctrl-B and a page-orientation change.
    editor.surface!.type('HACK');
    editor.surface!.deleteForward();
    editor.surface!.insertTab();
    editor.surface!.insertLineBreak();
    editor.surface!.toggleList('bullet');
    editor.surface!.toggleRunProperty('b');
    expect(bodyTextOf(editor)).toBe(before);
    expect(editor.surface!.state().lastRejection).toBe('the document is open for viewing');

    editor.setEditingMode('editing');
    editor.surface!.type('ok');
    expect(bodyTextOf(editor)).toContain('ok');
  });

  test('a refusal reaches the SNAPSHOT, so chrome can say why nothing happened', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('viewing');
    editor.surface!.type('nope');
    // The engine always knew; nothing published it, so a refused keystroke looked to the
    // user like the editor had stopped responding.
    expect(editor.snapshot().lastRejection).toBe('the document is open for viewing');

    editor.setEditingMode('editing');
    editor.surface!.type('ok');
    expect(editor.snapshot().lastRejection).toBeNull();
  });

  test('a refused accept reports WHY, instead of clearing the last refusal', () => {
    const editor = mount({ body: INSERTION });
    expect(editor.rejectReviewItem('revision-nope').ok).toBe(false);
    // Reported as a boolean, every refused accept cleared `lastRejection` rather than
    // setting it, so the surface forgot the one thing it knew about the failure.
    editor.setEditingMode('viewing');
    editor.acceptReviewItem(editor.getReviewItems()[0]!.key);
    expect(editor.surface!.state().lastRejection).not.toBeNull();
  });

  test('suggesting with no author refuses to DELETE rather than destroying text', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx({ body: PLAIN }),
      modules: [testReviewModule()],
    });
    editor.setEditingMode('suggesting');
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphIdOf(editor), offset: 0 },
      head: { paragraphId: paragraphIdOf(editor), offset: 5 },
    });
    editor.surface!.deleteBackward();
    // Nothing to attribute the proposal to, so nothing is proposed — and nothing is lost.
    // Writing it untracked would remove words the reviewer was promised they could recover.
    expect(editor.surface!.session.bodyText()).toContain('alpha beta');
  });

  test('accepting leaves the caret somewhere the next keystroke can land', () => {
    const editor = mount({ body: INSERTION });
    // Caret at the very end, inside the text the acceptance is about to reshape.
    const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    const end = editor.surface!.session.bodyText().length;
    editor.surface!.setSelection({
      anchor: { paragraphId: fragment.paragraphId, offset: end },
      head: { paragraphId: fragment.paragraphId, offset: end },
    });
    editor.rejectReviewItem(editor.getReviewItems()[0]!.key);

    // Rejecting removed the words the caret was in. Applying the ops without committing
    // through the surface left the caret past the end, and every keystroke after it was
    // refused with `offset-out-of-range` until the user clicked elsewhere.
    editor.surface!.type('!');
    expect(editor.surface!.session.bodyText()).toContain('!');
    expect(editor.surface!.state().lastRejection).toBeNull();
  });

  test('viewing refuses commands with the engine reason, and reverses', () => {
    const editor = mount({ body: PLAIN });
    editor.setEditingMode('viewing');
    const refused = editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('locked');

    editor.setEditingMode('editing');
    expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  });
});

describe('the review pane', () => {
  test('toggles as a command, so the toolbar button reads its own pressed state', () => {
    const editor = mount({ body: INSERTION });
    expect(editor.isReviewPaneOpen()).toBe(true);
    expect(editor.isActive({ type: 'toggleReviewPane' })).toBe(true);

    // A VIEW command: it moves no document, so it reports `changed: false` while still
    // moving the snapshot the chrome renders from.
    expect(editor.exec({ type: 'toggleReviewPane' })).toEqual({ ok: true, changed: false });
    expect(editor.isReviewPaneOpen()).toBe(false);
    expect(editor.isActive({ type: 'toggleReviewPane' })).toBe(false);
    expect(editor.snapshot().reviewPaneOpen).toBe(false);
  });

  test('reopens when suggesting commits another tracked change', () => {
    const editor = mount({ body: '<w:p><w:r><w:t>plain text</w:t></w:r></w:p>' });
    editor.setEditingMode('suggesting');
    editor.exec({ type: 'toggleReviewPane' });
    expect(editor.isReviewPaneOpen()).toBe(false);

    editor.surface!.type('X');

    expect(editor.isReviewPaneOpen()).toBe(true);
  });

  test('the queue counter moves on a toggle, so a subscriber re-renders', () => {
    const editor = mount({ body: INSERTION });
    const before = editor.getReviewRevision();
    editor.exec({ type: 'toggleReviewPane' });
    expect(editor.getReviewRevision()).not.toBe(before);
  });
});

describe('activating a card', () => {
  const COMMENTED =
    `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>` +
    `<w:commentRangeStart w:id="3"/><w:r><w:t>inside the comment</w:t></w:r>` +
    `<w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r>` +
    `<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>`;
  const COMMENT_PART = `<w:comment w:id="3" w:author="Ada Lovelace"><w:p><w:r><w:t>look here</w:t></w:r></w:p></w:comment>`;

  /** Put the caret at one offset in the story's only paragraph. */
  function caretAt(editor: DocxEditorInstance, offset: number): void {
    const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    const paragraphId = fragment.paragraphId;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  }

  test('the CARET opens the card, not a click — so keyboard and find open it too', () => {
    const editor = mount({ body: COMMENTED, comments: COMMENT_PART });
    const [card] = editor.getReviewItems();
    expect(card!.isActive).toBe(false);

    // "before " is 7 characters; anything past it is inside the commented range.
    caretAt(editor, 10);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);

    // Moving out closes it again. Nothing had to be cleared by hand.
    caretAt(editor, 1);
    expect(editor.getReviewItems()[0]!.isActive).toBe(false);
  });

  test('a dismissed card stays closed until the caret leaves it', () => {
    const editor = mount({ body: COMMENTED, comments: COMMENT_PART });
    caretAt(editor, 10);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);

    editor.setActiveReviewItem(null);
    expect(editor.getReviewItems()[0]!.isActive).toBe(false);

    // Moving the caret re-asks the question, which is how the reader reopens it. Setting
    // the SAME position would not: nothing moved, so nothing is re-asked.
    caretAt(editor, 1);
    caretAt(editor, 10);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);
  });

  test('opening a card selects its span and suppresses the comment affordance', () => {
    const editor = mount({ body: COMMENTED, comments: COMMENT_PART });
    const [card] = editor.getReviewItems();
    editor.setActiveReviewItem(card!.key);

    const selection = editor.surface!.state().selection;
    // The item's whole range, HEAD AT THE START: the selection overlay is the visible
    // highlight and the head is what the reveal scrolls to. The old regression this used
    // to guard — a range selection made "comment on this" offer a second comment on top
    // of the card just opened — is held off by `getSelectionPlacement` sitting out for
    // the review-driven selection, asserted right here.
    expect(selection.anchor.offset).toBeGreaterThan(selection.head.offset);
    expect(editor.getSelectionPlacement()).toBeNull();
    // And the card is open, which is the point of activating it.
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);

    // A selection the USER makes still gets the affordance.
    editor.surface!.setSelection({
      anchor: { paragraphId: selection.head.paragraphId, offset: 0 },
      head: { paragraphId: selection.head.paragraphId, offset: 3 },
    });
    expect(editor.getSelectionPlacement()).not.toBeNull();
  });

  test('selects the range the card is about, so the document shows what is meant', () => {
    const editor = mount({ body: INSERTION });
    const [card] = editor.getReviewItems();
    editor.setActiveReviewItem(card!.key);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);
    expect(bodyTextOf(editor)).toContain('added text');
    editor.setActiveReviewItem(null);
    expect(editor.getReviewItems()[0]!.isActive).toBe(false);
  });
});

const FORMAT_AND_INSERT =
  `<w:p><w:r><w:rPr>` +
  `<w:rPrChange w:id="3" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z"><w:b/></w:rPrChange>` +
  `<w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>` +
  INSERTION;

describe('getReviewItems query filtering', () => {
  test('excludeRevisionKinds omits excluded revision cards', () => {
    const editor = mount({ body: FORMAT_AND_INSERT });
    const all = editor.getReviewItems();
    const filtered = editor.getReviewItems({
      excludeRevisionKinds: ['format', 'structural'],
    });
    const kindsOf = (items: typeof all) =>
      items.map((item) => (item.kind === 'revision' ? item.revisionKind : item.kind));
    expect(kindsOf(all)).toContain('format');
    expect(kindsOf(all)).toContain('insert');
    expect(kindsOf(filtered)).not.toContain('format');
    expect(kindsOf(filtered)).not.toContain('structural');
    expect(kindsOf(filtered)).toContain('insert');
  });

  test('placement:false returns same metadata with null anchors', () => {
    const editor = mount({ body: FORMAT_AND_INSERT });
    const unplaced = editor.getReviewItems({ placement: false });
    const placed = editor.getReviewItems();
    expect(unplaced).toHaveLength(placed.length);
    expect(unplaced.every((item) => item.anchorY === null && item.pageIndex === null)).toBe(true);
    expect(unplaced.map((item) => item.key)).toEqual(placed.map((item) => item.key));
    expect(unplaced.map((item) => item.text)).toEqual(placed.map((item) => item.text));
    expect(unplaced.map((item) => item.author)).toEqual(placed.map((item) => item.author));
  });

  test('filtering out every revision kind returns an empty list', () => {
    const editor = mount({ body: FORMAT_AND_INSERT });
    const empty = editor.getReviewItems({
      excludeRevisionKinds: [
        'insert',
        'delete',
        'replace',
        'moveFrom',
        'moveTo',
        'format',
        'paragraphMark',
        'structural',
      ],
    });
    expect(empty).toHaveLength(0);
  });

  test('omitted query returns every placement with geometry', () => {
    const editor = mount({ body: FORMAT_AND_INSERT });
    const items = editor.getReviewItems();
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.anchorY !== null)).toBe(true);
  });
});

// A tracked change in a header is a pending decision like any other: it must reach the
// queue, carry real geometry, resolve against ITS story, and tell a programmatic consumer
// which story holds it. A queue that only walked the body hid all of that.
const HEADER_INSERTION =
  `<w:p><w:r><w:t xml:space="preserve">Confidential </w:t></w:r>` +
  `<w:ins w:id="7" w:author="Margaret Hamilton" w:date="2026-03-04T05:06:07Z">` +
  `<w:r><w:t>draft</w:t></w:r></w:ins></w:p>`;

describe('tracked changes in headers', () => {
  test('a header revision gets a card, with geometry from the furniture layout', () => {
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const cards = editor.getReviewItems();
    expect(cards).toHaveLength(2);
    const header = cards.find((card) => card.author === 'Margaret Hamilton');
    expect(header).toBeDefined();
    expect(header!.text).toBe('draft');
    expect(header!.readOnly).toBe(false);
    expect(header!.pageIndex).toBe(0);
    expect(header!.anchorY).not.toBeNull();
    // The header sits ABOVE the body content on the sheet, and its card rides before the
    // body's in the rail: the rail stacks top-down and never lifts a card past its anchor.
    const body = cards.find((card) => card.author === 'Ada Lovelace')!;
    expect(cards.indexOf(header!)).toBeLessThan(cards.indexOf(body));
    expect(header!.anchorY!).toBeLessThan(body.anchorY!);
  });

  test('getTrackedChanges names the story each change lives in', () => {
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const stories = editor
      .getTrackedChanges()
      .map((change) => change.story)
      .sort();
    expect(stories).toEqual(['body', 'header']);
  });

  test('accepting a header revision resolves it inside the header story', () => {
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const header = editor.getReviewItems().find((card) => card.author === 'Margaret Hamilton')!;
    expect(editor.acceptReviewItem(header.key)).toEqual({ ok: true, changed: true });
    // The card is gone, the body's card is untouched, and the header kept the words.
    const remaining = editor.getReviewItems();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.author).toBe('Ada Lovelace');
    const storyText =
      editor.surface!.session.storyText({ kind: 'headerFooter', rId: 'rIdH' }) ?? '';
    expect(storyText).toContain('draft');
  });

  test('rejecting a header insertion removes its words from the header story', () => {
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const header = editor.getReviewItems().find((card) => card.author === 'Margaret Hamilton')!;
    expect(editor.rejectReviewItem(header.key)).toEqual({ ok: true, changed: true });
    const storyText =
      editor.surface!.session.storyText({ kind: 'headerFooter', rId: 'rIdH' }) ?? '';
    expect(storyText).not.toContain('draft');
    expect(bodyTextOf(editor)).toContain('added text');
  });

  test('undoing a header accept brings the card back, with the tick moving each time', () => {
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const header = editor.getReviewItems().find((card) => card.author === 'Margaret Hamilton')!;
    const before = editor.getReviewRevision();
    expect(editor.acceptReviewItem(header.key)).toEqual({ ok: true, changed: true });
    const afterAccept = editor.getReviewRevision();
    // An accept inside a header moves only the PACKAGE revision; a tick watching the body
    // alone froze the rail, so undoing the accept restored the change with no card beside it.
    expect(afterAccept).not.toBe(before);
    editor.surface!.undo();
    expect(editor.getReviewRevision()).not.toBe(afterAccept);
    expect(
      editor.getReviewItems().filter((card) => card.author === 'Margaret Hamilton')
    ).toHaveLength(1);
  });

  test('opening a header card enters the header scope, like Word', () => {
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const header = editor.getReviewItems().find((card) => card.author === 'Margaret Hamilton')!;
    editor.setActiveReviewItem(header.key);
    expect(editor.surface!.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdH' });
    expect(editor.getHeaderFooterState()?.editing).toBe('header');
  });

  test('the header card lights up, rather than only opening the scope', () => {
    // Entering the scope used to `return` before announcing, so the rail never
    // re-rendered: the reader clicked a header card, the document scope changed under
    // them, and no card looked open.
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const header = editor.getReviewItems().find((card) => card.author === 'Margaret Hamilton')!;
    editor.setActiveReviewItem(header.key);
    const active = editor.getReviewItems().find((card) => card.author === 'Margaret Hamilton')!;
    expect(active.isActive).toBe(true);
  });

  test('accepting a header card leaves the caret inside the header, still typable', () => {
    // The post-commit clamp used the BODY's paragraph list, so resolving a header card
    // threw the caret into the document while the scope stayed on the header — and every
    // keystroke after it was refused as `unknown-paragraph`. The reader typed and nothing
    // happened.
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const header = editor.getReviewItems().find((card) => card.author === 'Margaret Hamilton')!;
    editor.setActiveReviewItem(header.key);
    expect(editor.surface!.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdH' });

    expect(editor.acceptReviewItem(header.key)).toEqual({ ok: true, changed: true });
    const caret = editor.surface!.state().selection.head.paragraphId;
    const bodyParagraphs = editor.surface!.session.paragraphIds();
    expect(bodyParagraphs).not.toContain(caret);
  });

  test('replying to a header card lands, rather than being refused every time', () => {
    // The reply was always written against the body store, so a header anchor named a
    // paragraph that store had never heard of and the transaction was rejected: the reply
    // box accepted text and threw it away.
    const HEADER_COMMENT =
      `<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>letterhead</w:t></w:r>` +
      `<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>`;
    const editor = mount({
      body: INSERTION,
      header: HEADER_COMMENT,
      comments:
        `<w:comment w:id="7" w:author="Margaret Hamilton" w:date="2026-03-04T05:06:07Z">` +
        `<w:p><w:r><w:t>Wrong wordmark.</w:t></w:r></w:p></w:comment>`,
    });
    const card = editor.getReviewItems().find((item) => item.kind === 'comment')!;
    expect(editor.replyToReviewItem(card.key, 'Fixed in the new template.')).toEqual({
      ok: true,
      changed: true,
    });
    const replies = editor
      .getReviewItems()
      .filter((item) => item.kind === 'comment' && item.text.includes('Fixed in the new template'));
    expect(replies.length).toBeGreaterThan(0);
  });

  test('walking header card then body card re-activates the BODY', () => {
    // The traversal a reviewer actually performs. The body branch never left the header
    // scope, so the caret stayed clamped inside the header story and no body card could
    // become active again — the rail went dead from the first header change onward.
    const editor = mount({ body: INSERTION, header: HEADER_INSERTION });
    const header = editor.getReviewItems().find((card) => card.author === 'Margaret Hamilton')!;
    const body = editor.getReviewItems().find((card) => card.author === 'Ada Lovelace')!;

    editor.setActiveReviewItem(header.key);
    expect(editor.surface!.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdH' });

    editor.setActiveReviewItem(body.key);
    expect(editor.surface!.activeScope()).toEqual({ kind: 'body' });
    expect(editor.getHeaderFooterState()?.editing ?? null).toBeNull();
    const cards = editor.getReviewItems();
    expect(cards.find((card) => card.author === 'Ada Lovelace')!.isActive).toBe(true);
    expect(cards.find((card) => card.author === 'Margaret Hamilton')!.isActive).toBe(false);

    // And back again, so the walk is not a one-way door.
    editor.setActiveReviewItem(header.key);
    expect(editor.surface!.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdH' });
  });

  test('deleting a header comment strips its markers even after the header was opened', () => {
    const HEADER_COMMENT =
      `<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>letterhead</w:t></w:r>` +
      `<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>`;
    const editor = mount({
      body: INSERTION,
      header: HEADER_COMMENT,
      comments:
        `<w:comment w:id="7" w:author="Margaret Hamilton" w:date="2026-03-04T05:06:07Z">` +
        `<w:p><w:r><w:t>Wrong wordmark.</w:t></w:r></w:p></w:comment>`,
    });
    const card = editor.getReviewItems().find((item) => item.kind === 'comment')!;
    expect(card).toBeDefined();

    // Opening the header OPENS its story store, which is the whole point of this case: the
    // package shell re-overlays every opened store's own part, so a delete that stripped the
    // markers inside the body store's working package had them put straight back — a header
    // with a `commentRangeStart` naming a comment the package no longer defines.
    editor.setActiveReviewItem(card.key);
    expect(editor.surface!.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rIdH' });
    editor.setActiveScope({ kind: 'body' });

    expect(editor.deleteReviewItem(card.key).ok).toBe(true);
    expect(editor.getReviewItems().some((item) => item.kind === 'comment')).toBe(false);

    const headerXml = serializeOoxmlPart(
      editor.surface!.session.currentPackage().parts.get('/word/header1.xml')!
    );
    expect(headerXml).not.toContain('commentRangeStart');
    expect(headerXml).not.toContain('commentReference');
    expect(headerXml).toContain('letterhead');
  });
});

// Clicking tracked text is how a reviewer opens its card — there is no click handler, the
// CARET decides. Everything that stops the caret's answer from reaching the rail reads to
// the user as "clicking the change does nothing".
describe('the caret activates the card the rail actually renders', () => {
  const REPLACEMENT_DAYS_APART =
    `<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>` +
    `<w:del w:id="11" w:author="Ada Lovelace" w:date="2026-01-01T10:00:00Z">` +
    `<w:r><w:delText>old</w:delText></w:r></w:del>` +
    `<w:ins w:id="12" w:author="Ada Lovelace" w:date="2026-01-02T09:00:00Z">` +
    `<w:r><w:t>new</w:t></w:r></w:ins></w:p>`;

  function caretAt(editor: DocxEditorInstance, offset: number): void {
    const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    editor.surface!.setSelection({
      anchor: { paragraphId: fragment.paragraphId, offset },
      head: { paragraphId: fragment.paragraphId, offset },
    });
  }

  test('a caret in either half of a replacement opens the ONE paired card', () => {
    const editor = mount({ body: REPLACEMENT_DAYS_APART });
    const cards = editor.getReviewItems();
    expect(cards).toHaveLength(1);
    expect(cards[0]!.kind === 'revision' && cards[0]!.revisionKind).toBe('replace');

    // "keep " is 5 characters, then the struck "old", then the typed "new".
    caretAt(editor, 6);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);
    caretAt(editor, 0);
    expect(editor.getReviewItems()[0]!.isActive).toBe(false);
    caretAt(editor, 9);
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);
  });

  test('an excluded kind cannot take the activation from a kind the rail shows', () => {
    // A format change wrapping text the rail hides used to win the innermost-covering
    // test and open a card nothing renders — the click looked ignored.
    const editor = mount({ body: FORMAT_AND_INSERT });
    const formatCard = editor
      .getReviewItems()
      .find((card) => card.kind === 'revision' && card.revisionKind === 'format')!;
    expect(formatCard).toBeDefined();

    const formatParagraph = editor.surface!.layout().pages[0]!.fragments[0]!;
    if (formatParagraph.kind !== 'paragraph') throw new Error('expected a paragraph');
    const intoFormat = { paragraphId: formatParagraph.paragraphId, offset: 2 };
    editor.surface!.setSelection({ anchor: intoFormat, head: intoFormat });
    expect(editor.surface!.activeReviewKey()).toBe(formatCard.key);

    // The rail hides format cards by default; told so, the engine stops activating them.
    editor.setReviewActivationExclusions(['format', 'structural']);
    expect(editor.surface!.activeReviewKey()).toBeNull();

    // And clearing the filter restores the engine's own answer.
    editor.setReviewActivationExclusions(null);
    expect(editor.surface!.activeReviewKey()).toBe(formatCard.key);
  });

  test('activating a card ANNOUNCES it, so a pull-only host cannot miss the change', () => {
    // The regression this guards is invisible to `getReviewItems()`: a snapshot read is a
    // PULL, and every adapter renders off the pushed event. A `setActive` that updated
    // state without emitting left the rail showing the previously open card.
    const editor = mount({ body: INSERTION });
    let announced = 0;
    const stop = editor.on('selectionChange', () => {
      announced += 1;
    });
    const [card] = editor.getReviewItems();
    editor.setActiveReviewItem(card!.key);
    expect(announced).toBeGreaterThan(0);

    const afterOpen = announced;
    editor.setActiveReviewItem(null);
    expect(announced).toBeGreaterThan(afterOpen);
    stop();
  });
});
