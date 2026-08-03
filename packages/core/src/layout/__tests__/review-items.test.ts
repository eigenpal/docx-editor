// Comment anchors, the review item list, and caret activation.
//
// Activation is the behaviour a reviewer feels: put the caret in commented or revised text and
// that card becomes the active one, ready to reply to. The rules that decide whether it feels
// right are the boundary case (a caret resting at the end of a range) and the nesting case
// (which of two overlapping comments is meant).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readOoxmlPackage,
  readOoxmlPart,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';
import { commentAnchorsOfStory, commentsOfPart, threadStateOfPart } from '../comment-anchors.ts';
import {
  activeReviewItem,
  commentItemsOf,
  paragraphOrderOf,
  revisionItemsOf,
  sortReviewItems,
  type ReviewItem,
} from '../review-items.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function loadComments(inner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${inner}</w:comments>`,
    { name: '/word/comments.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function loadExtended(inner: string): OoxmlPart {
  const result = readOoxmlPart(`<w15:commentsEx xmlns:w15="${W15}">${inner}</w15:commentsEx>`, {
    name: '/word/commentsExtended.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const start = (id: string) => `<w:commentRangeStart w:id="${id}"/>`;
const end = (id: string) =>
  `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
const comment = (id: string, text: string, paraId?: string) =>
  `<w:comment w:id="${id}" w:author="QA Reviewer" w:initials="QR" w:date="2026-03-26T11:00:00Z">` +
  `<w:p${paraId ? ` w14:paraId="${paraId}"` : ''}>${run(text)}</w:p></w:comment>`;

describe('comment anchors', () => {
  test('a range resolves to model offsets in the same space as layout', () => {
    // `AB` before the range, `CDE` inside it, `FG` after: offsets 2..5.
    const part = load(`<w:p>${run('AB')}${start('0')}${run('CDE')}${end('0')}${run('FG')}</w:p>`);
    const anchors = commentAnchorsOfStory(part);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.start.offset).toBe(2);
    expect(anchors[0]!.end.offset).toBe(5);
    expect(anchors[0]!.orphaned).toBe(false);
  });

  test('a range spanning paragraphs keeps both endpoints', () => {
    const part = load(
      `<w:p>${run('first ')}${start('0')}${run('half')}</w:p>` +
        `<w:p>${run('second half')}${end('0')}</w:p>`
    );
    const anchor = commentAnchorsOfStory(part)[0]!;
    expect(anchor.start.paragraphId).not.toBe(anchor.end.paragraphId);
    expect(anchor.orphaned).toBe(false);
  });

  test('overlapping ranges both resolve, because Word produces them', () => {
    const part = load(
      `<w:p>${start('0')}${run('one ')}${start('1')}${run('two')}${end('0')}${run(' three')}${end('1')}</w:p>`
    );
    const anchors = commentAnchorsOfStory(part);
    expect(anchors.map((anchor) => anchor.commentId).sort()).toEqual(['0', '1']);
    expect(anchors.every((anchor) => !anchor.orphaned)).toBe(true);
  });

  test('a start with no end is reported orphaned rather than guessed at', () => {
    // Extending it to the next end marker would attach the remark to text nobody commented on.
    const part = load(`<w:p>${start('0')}${run('unterminated')}</w:p>`);
    expect(commentAnchorsOfStory(part)[0]!.orphaned).toBe(true);
  });

  test('a comment range inside tracked content anchors at the right offset', () => {
    const part = load(
      `<w:p>${run('AB')}` +
        `<w:ins w:id="9" w:author="QA" w:date="2026-03-26T11:00:00Z">` +
        `${start('0')}${run('CD')}${end('0')}</w:ins></w:p>`
    );
    const anchor = commentAnchorsOfStory(part)[0]!;
    expect([anchor.start.offset, anchor.end.offset]).toEqual([2, 4]);
  });
});

describe('thread state comes from the sibling part', () => {
  test('a reply is a reply because commentsExtended says so', () => {
    const state = threadStateOfPart(
      loadExtended(
        '<w15:commentEx w15:paraId="10000000" w15:done="0"/>' +
          '<w15:commentEx w15:paraId="10000001" w15:paraIdParent="10000000" w15:done="0"/>'
      )
    );
    expect(state.get('10000000')?.parentParaId).toBeUndefined();
    expect(state.get('10000001')?.parentParaId).toBe('10000000');
  });

  test('prose that opens with "Reply:" is not a reply', () => {
    // The comprehensive fixture's comment 3 does exactly this. Inferring a thread from wording
    // would work on that file and produce false threads on every other one.
    const comments = commentsOfPart(
      loadComments(comment('0', 'first') + comment('3', 'Reply: I added CJK examples.'))
    );
    const items = commentItemsOf(comments, [], new Map());
    expect(items.every((item) => item.kind === 'comment' && item.parentId === undefined)).toBe(
      true
    );
  });

  test('done reads as ST_OnOff, so done="0" is unresolved', () => {
    const state = threadStateOfPart(
      loadExtended(
        '<w15:commentEx w15:paraId="A0000000" w15:done="0"/>' +
          '<w15:commentEx w15:paraId="B0000000" w15:done="1"/>'
      )
    );
    expect(state.get('A0000000')?.done).toBe(false);
    expect(state.get('B0000000')?.done).toBe(true);
  });
});

describe('review items', () => {
  const body = load(
    `<w:p>${run('plain ')}${start('0')}${run('commented')}${end('0')}${run(' and ')}` +
      `<w:ins w:id="7" w:author="QA" w:date="2026-03-26T11:00:00Z">${run('inserted')}</w:ins>` +
      `</w:p>`
  );

  function itemsOf(): { items: ReviewItem[]; order: Map<string, number> } {
    const layout = layoutSemanticDocument(body, 1, { measurer });
    const order = paragraphOrderOf(layout);
    const comments = commentsOfPart(loadComments(comment('0', 'needs a source')));
    const anchors = commentAnchorsOfStory(body);
    const items = sortReviewItems(
      [...revisionItemsOf(layout, body.name), ...commentItemsOf(comments, anchors, new Map())],
      order
    );
    return { items, order };
  }

  test('revisions and comments list together, in document order', () => {
    const { items } = itemsOf();
    expect(items.map((item) => item.kind)).toEqual(['comment', 'revision']);
  });

  test('a revision card coalesces its spans into one decision', () => {
    // Word-broken spans would otherwise list a sentence-long insertion once per word.
    const { items } = itemsOf();
    const revision = items.find((item) => item.kind === 'revision');
    expect(revision?.kind === 'revision' && revision.text).toBe('inserted');
  });

  test('a comment card carries the author and body the file authored', () => {
    const { items } = itemsOf();
    const card = items.find((item) => item.kind === 'comment');
    expect(card?.kind === 'comment' && card.comment.author).toBe('QA Reviewer');
    expect(card?.kind === 'comment' && card.comment.initials).toBe('QR');
  });
});

describe('caret activation', () => {
  const body = load(
    `<w:p>${run('AB')}${start('0')}${run('CDE')}${end('0')}${run('FG')}` +
      `<w:ins w:id="7" w:author="QA" w:date="2026-03-26T11:00:00Z">${run('HI')}</w:ins></w:p>`
  );
  const layout = layoutSemanticDocument(body, 1, { measurer });
  const order = paragraphOrderOf(layout);
  const paragraphId = [...order.keys()][0]!;

  function itemsWith(resolvedIds: readonly string[] = []): ReviewItem[] {
    const comments = commentsOfPart(loadComments(comment('0', 'a remark', '10000000')));
    const state = new Map(
      resolvedIds.includes('0') ? [['10000000', { done: true }]] : ([] as never[])
    );
    return sortReviewItems(
      [
        ...revisionItemsOf(layout, body.name),
        ...commentItemsOf(comments, commentAnchorsOfStory(body), state),
      ],
      order
    );
  }

  const activeAt = (offset: number, items = itemsWith()): string | null => {
    const item = activeReviewItem(items, { paragraphId, offset }, order);
    if (!item) return null;
    return item.kind === 'comment' ? `comment-${item.id}` : `revision-${item.revision.kind}`;
  };

  test('a caret inside a commented range activates that comment', () => {
    expect(activeAt(3)).toBe('comment-0');
  });

  test('a caret at the trailing boundary still activates it', () => {
    // Offset 5 is immediately after the last commented character. Requiring the caret to be
    // strictly inside makes the last character of every comment feel dead.
    expect(activeAt(5)).toBe('comment-0');
  });

  test('a caret at the leading boundary activates it too', () => {
    expect(activeAt(2)).toBe('comment-0');
  });

  test('a caret outside every range activates nothing', () => {
    expect(activeAt(6)).toBeNull();
  });

  test('a caret inside a revision activates that revision', () => {
    expect(activeAt(8)).toBe('revision-insert');
  });

  test('a resolved comment does not steal activation', () => {
    // Otherwise a settled thread reopens itself as soon as the reviewer types near it.
    expect(activeAt(3, itemsWith(['0']))).toBeNull();
  });

  test('the innermost range wins when comments nest', () => {
    const nested = load(
      `<w:p>${start('0')}${run('outer ')}${start('1')}${run('inner')}${end('1')}` +
        `${run(' outer')}${end('0')}</w:p>`
    );
    const nestedLayout = layoutSemanticDocument(nested, 1, { measurer });
    const nestedOrder = paragraphOrderOf(nestedLayout);
    const items = commentItemsOf(
      commentsOfPart(loadComments(comment('0', 'wide') + comment('1', 'narrow'))),
      commentAnchorsOfStory(nested),
      new Map()
    );
    const at = (offset: number) =>
      activeReviewItem(items, { paragraphId: [...nestedOrder.keys()][0]!, offset }, nestedOrder);
    // Offset 8 is inside both; the tighter range is the one the reader means.
    const active = at(8);
    expect(active?.kind === 'comment' && active.id).toBe('1');
  });

  test('activation applies no operation to the document', () => {
    // A view state, not an edit. Asserted by the absence of any op in this path: the function
    // takes records and a position and returns an item.
    const items = itemsWith();
    expect(activeReviewItem(items, { paragraphId, offset: 3 }, order)).not.toBeNull();
    expect(activeReviewItem(items, { paragraphId, offset: 3 }, order)).toBe(
      activeReviewItem(items, { paragraphId, offset: 3 }, order)
    );
  });
});

describe('against the comprehensive fixture', () => {
  const FIXTURE = resolve(
    import.meta.dir,
    '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
  );

  test('its four comments load, anchor, and stay flat', () => {
    const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
    if (!pkg.ok) throw new Error(pkg.reason);
    const body = pkg.package.parts.get('/word/document.xml')!;
    const commentsPart = pkg.package.parts.get('/word/comments.xml')!;

    const comments = commentsOfPart(commentsPart);
    expect(comments).toHaveLength(4);
    expect(comments.map((entry) => entry.author)).toContain('QA Reviewer');

    const anchors = commentAnchorsOfStory(body);
    expect(anchors).toHaveLength(4);
    expect(anchors.every((anchor) => !anchor.orphaned)).toBe(true);

    // No sibling parts in this package, so no threads and no resolved state — including for
    // the comment whose text opens with "Reply:".
    expect(pkg.package.parts.get('/word/commentsExtended.xml')).toBeUndefined();
    const items = commentItemsOf(comments, anchors, new Map());
    expect(items.every((item) => item.kind === 'comment' && item.parentId === undefined)).toBe(
      true
    );
    expect(items.every((item) => item.kind === 'comment' && !item.resolved)).toBe(true);
  });
});
