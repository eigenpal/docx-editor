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
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';

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
}

function docx({ body, comments }: DocxParts): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (comments ? `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>` : '') +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w15="${W15}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (comments) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    );
    files['word/comments.xml'] = strToU8(
      `<w:comments xmlns:w="${W}" xmlns:w15="${W15}">${comments}</w:comments>`
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
  const editor = createDocxEditor({ container, document: docx(parts), author: 'Grace Hopper' });
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

describe('the review queue the facade publishes', () => {
  test('a card arrives presentation-ready, so no host derives it from the tree', () => {
    const editor = mount({ body: INSERTION });
    const [card] = editor.getReviewItems();
    expect(card).toBeDefined();
    expect(card!.kind).toBe('revision');
    expect(card!.revisionKind).toBe('insert');
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
    expect(card!.revisionKind).toBe('delete');
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
    expect(replacement?.replacedText).toBe('first');
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
    const roots = items.filter((item) => item.parentId === undefined);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.replyIds).toHaveLength(1);

    const reply = items.find((item) => item.parentId !== undefined);
    expect(reply?.text).toBe('Yes, checked against the schedule.');
    // The AMBIENT author, from `EditorConfig.author` — `CT_Comment` requires one.
    expect(reply?.author).toBe('Grace Hopper');
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
    });
    const reply = reopened.getReviewItems().find((item) => item.parentId !== undefined);
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
    const root = editor.getReviewItems().find((item) => item.parentId === undefined);
    expect(root?.isActive).toBe(true);
    const reply = editor.getReviewItems().find((item) => item.parentId !== undefined);
    expect(reply?.isActive).toBe(false);
  });

  test('a reply with no author anywhere is refused rather than written as an empty attribute', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx({ body: COMMENTED_BODY, comments: COMMENTS }),
    });
    const [card] = editor.getReviewItems();
    const result = editor.replyToReviewItem(card!.key, 'anonymous');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalidArgs');
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
    expect(card?.revisionKind).toBe('insert');
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
    expect(card?.revisionKind).toBe('delete');
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
    expect(cards[0]!.revisionKind).toBe('delete');
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
    expect(cards[0]!.revisionKind).toBe('replace');
    expect(cards[0]!.replacedText).toBe('ha be');
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
    expect(cards[0]!.revisionKind).toBe('replace');
    // The reference measures ONE model unit, exactly as `segmentsOf` counts it, so [19, 39)
    // is "ence" + the reference + " and second end". Counting it as nothing shifted every
    // offset past it by one and struck a character the user had not selected.
    expect(cards[0]!.replacedText).toBe('ence and second end');
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
    expect(cards[0]!.revisionKind).toBe('replace');
    expect(cards[0]!.replacedText).toBe('alpha');
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
    const kinds = editor.getReviewItems().map((item) => item.revisionKind);
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
    const mark = editor.getReviewItems().find((item) => item.revisionKind === 'paragraphMark');
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
    expect(active?.revisionKind).toBe('paragraphMark');
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
    const marks = editor.getReviewItems().filter((item) => item.revisionKind === 'paragraphMark');
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
    const editor = createDocxEditor({ container, document: docx({ body: PLAIN }) });
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

  test('opening a card places the CARET, and never selects the text', () => {
    const editor = mount({ body: COMMENTED, comments: COMMENT_PART });
    const [card] = editor.getReviewItems();
    editor.setActiveReviewItem(card!.key);

    const selection = editor.surface!.state().selection;
    // Collapsed. A range selection turned the text grey and made the "comment on this"
    // affordance offer a second comment on top of the one just opened.
    expect(selection.anchor.paragraphId).toBe(selection.head.paragraphId);
    expect(selection.anchor.offset).toBe(selection.head.offset);
    expect(editor.getSelectionPlacement()).toBeNull();
    // And the card is open, which is the point of activating it.
    expect(editor.getReviewItems()[0]!.isActive).toBe(true);
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
    expect(all.some((item) => item.revisionKind === 'format')).toBe(true);
    expect(all.some((item) => item.revisionKind === 'insert')).toBe(true);
    expect(filtered.some((item) => item.revisionKind === 'format')).toBe(false);
    expect(filtered.some((item) => item.revisionKind === 'structural')).toBe(false);
    expect(filtered.some((item) => item.revisionKind === 'insert')).toBe(true);
  });

  test('placement:false returns same metadata with null anchors', () => {
    const editor = mount({ body: FORMAT_AND_INSERT });
    const unplaced = editor.getReviewItems({ placement: false });
    const placed = editor.getReviewItems();
    expect(unplaced).toHaveLength(placed.length);
    expect(unplaced.every((item) => item.anchorY === null && item.pageIndex === null)).toBe(
      true
    );
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
