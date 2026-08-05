/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review queue.
//
// The rule this file exists to protect: the queue is a property of the DOCUMENT, not of the
// current view. Derived from laid-out spans it emptied by half whenever a reader switched
// display mode, and the changes that vanished became unreachable from the surface meant to
// resolve them.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readOoxmlPackage,
  readOoxmlPart,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';
import {
  activeReviewItem,
  commentBodyText,
  commentInitials,
  paragraphOrderOfPart,
  reviewAnchorIndex,
  reviewItemGeometry,
  reviewItemsAt,
  type ReviewItem,
  type ReviewRevisionItem,
} from '@docx-editor.dev/core-contract/layout';
import { collectReviewItems, revisionItemsOf } from '../review/review-model.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

function story(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function commentsPart(inner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${inner}</w:comments>`,
    {
      name: '/word/comments.xml',
      contentType: 'app/xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function extendedPart(inner: string): OoxmlPart {
  const result = readOoxmlPart(`<w15:commentsEx xmlns:w15="${W15}">${inner}</w15:commentsEx>`, {
    name: '/word/commentsExtended.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (id: string, inner: string, author = 'QA') =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="D">${inner}</w:ins>`;
const del = (id: string, inner: string, author = 'Dev') =>
  `<w:del w:id="${id}" w:author="${author}" w:date="D">${inner}</w:del>`;
const cStart = (id: string) => `<w:commentRangeStart w:id="${id}"/>`;
const cEnd = (id: string) =>
  `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
const comment = (id: string, text: string, paraId?: string) =>
  `<w:comment w:id="${id}" w:author="QA Reviewer" w:initials="QR" w:date="D">` +
  `<w:p${paraId ? ` w14:paraId="${paraId}"` : ''}>${run(text)}</w:p></w:comment>`;

const revisionsOf = (items: readonly ReviewItem[]): ReviewRevisionItem[] =>
  items.filter((item): item is ReviewRevisionItem => item.kind === 'revision');

describe('the queue is a property of the document, not of the view', () => {
  const part = story(
    `<w:p>${run('keep ')}${ins('1', run('new '))}${del('2', delRun('old'))}</w:p>`
  );

  test('both an insertion and a deletion are listed', () => {
    const kinds = revisionsOf(collectReviewItems({ storyPart: part })).map(
      (item) => item.revisionKind
    );
    expect(kinds.sort()).toEqual(['delete', 'insert']);
  });

  test('the list does not depend on any layout, so no display mode can empty it', () => {
    // The old model walked laid-out spans, and the proposed-result mode drops every deletion.
    // Nothing here takes a layout at all.
    expect(collectReviewItems({ storyPart: part })).toHaveLength(2);
  });
});

describe('changes that decorate no characters still get a card', () => {
  test('a tracked format change is listed', () => {
    const part = story(
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="5" w:author="QA" w:date="D">` +
        `<w:rPr/></w:rPrChange></w:rPr><w:t>reformatted</w:t></w:r></w:p>`
    );
    const item = revisionsOf(collectReviewItems({ storyPart: part }))[0]!;
    expect(item.revisionKind).toBe('format');
    expect(item.readOnly).toBe(false);
    expect(item.author).toBe('QA');
  });

  test('a paragraph-mark revision is listed', () => {
    const part = story(
      `<w:p><w:pPr><w:rPr><w:del w:id="6" w:author="QA" w:date="D"/></w:rPr></w:pPr>${run('x')}</w:p>`
    );
    expect(revisionsOf(collectReviewItems({ storyPart: part }))[0]!.revisionKind).toBe(
      'paragraphMark'
    );
  });

  test('a complete tracked row revision is listed and resolvable', () => {
    // It has to be visible: `acceptAllRevisions` refuses if any revision is unresolvable, so
    // an invisible one makes Accept All fail for a reason nothing on screen explains.
    const part = story(
      `<w:tbl><w:tr><w:trPr><w:del w:id="7" w:author="QA" w:date="D"/></w:trPr>` +
        `<w:tc><w:tcPr><w:cellDel w:id="7" w:author="QA" w:date="D"/></w:tcPr>` +
        `<w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`
    );
    const item = revisionsOf(collectReviewItems({ storyPart: part }))[0]!;
    expect(item.revisionKind).toBe('structural');
    expect(item.readOnly).toBe(false);
    expect(item.ranges).toHaveLength(1);
  });
});

describe('one decision is one card', () => {
  test('sites sharing a triple coalesce, listing every range', () => {
    const part = story(`<w:p>${ins('1', run('one'))}${run(' and ')}${ins('1', run('two'))}</w:p>`);
    const items = revisionsOf(collectReviewItems({ storyPart: part }));
    expect(items).toHaveLength(1);
    expect(items[0]!.ranges).toHaveLength(2);
    expect(items[0]!.text).toBe('onetwo');
  });

  test('two authors sharing an id are two cards', () => {
    const part = story(
      `<w:p>${ins('1', run('mine'), 'Ada')}${ins('1', run('theirs'), 'Grace')}</w:p>`
    );
    expect(revisionsOf(collectReviewItems({ storyPart: part }))).toHaveLength(2);
  });

  test('card ids are unique, so a list key never collides', () => {
    const part = story(
      `<w:p>${ins('7', run('a'))}${run(' x ')}${ins('7', run('b'))}${del('7', delRun('c'), 'QA')}</w:p>`
    );
    const ids = revisionsOf(collectReviewItems({ storyPart: part })).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a card carries the address accept and reject take', () => {
    const part = story(`<w:p>${ins('4', run('x'), 'QA')}</w:p>`);
    expect(revisionsOf(collectReviewItems({ storyPart: part }))[0]!.address).toEqual({
      id: '4',
      author: 'QA',
      date: 'D',
    });
  });
});

describe('a replacement says where its halves divide', () => {
  test('the struck ranges come first, and the card counts them', () => {
    // Two independent revisions by one author, meeting end to start — the shape a foreign
    // editor writes a replacement in.
    const part = story(
      `<w:p>${run('keep ')}${del('2', delRun('old'), 'QA')}${ins('1', run('new'), 'QA')}</w:p>`
    );
    const item = revisionsOf(collectReviewItems({ storyPart: part }))[0]!;
    expect(item.revisionKind).toBe('replace');
    expect(item.ranges).toHaveLength(2);
    // Without this a surface painting the pair has to pick one colour for both halves.
    expect(item.replacedRangeCount).toBe(1);
    const struck = item.ranges[0]!;
    expect(struck.start.offset).toBe(5);
    expect(struck.end.offset).toBe(8);
  });

  test('a deletion split across several elements is counted in full', () => {
    // A `w:del` cannot hold the `w:tab` between the words it strikes, so one edit becomes
    // two elements under one id — and the split point is 2, not 1.
    const part = story(
      `<w:p>${del('2', delRun('one'), 'QA')}<w:r><w:tab/></w:r>` +
        `${del('2', delRun('two'), 'QA')}${ins('1', run('new'), 'QA')}</w:p>`
    );
    const item = revisionsOf(collectReviewItems({ storyPart: part }))[0]!;
    expect(item.revisionKind).toBe('replace');
    expect(item.replacedRangeCount).toBe(2);
    expect(item.ranges).toHaveLength(3);
  });

  test('a plain insertion has no split point at all', () => {
    const part = story(`<w:p>${ins('1', run('new'))}</w:p>`);
    const item = revisionsOf(collectReviewItems({ storyPart: part }))[0]!;
    expect(item.replacedRangeCount).toBeUndefined();
  });
});

describe('comments', () => {
  const part = story(`<w:p>${run('AB')}${cStart('0')}${run('CDE')}${cEnd('0')}${run('FG')}</w:p>`);

  test('a comment carries its body text and initials without the surface walking runs', () => {
    const items = collectReviewItems({
      storyPart: part,
      commentsPart: commentsPart(comment('0', 'needs a source')),
    });
    const card = items.find((item) => item.kind === 'comment')!;
    if (card.kind !== 'comment') return;
    expect(commentBodyText(card.comment)).toBe('needs a source');
    expect(commentInitials(card.comment)).toBe('QR');
  });

  test('initials fall back to the author name when the file gives none', () => {
    const items = collectReviewItems({
      storyPart: part,
      commentsPart: commentsPart(
        `<w:comment w:id="0" w:author="Ada Lovelace" w:date="D"><w:p>${run('hi')}</w:p></w:comment>`
      ),
    });
    const card = items.find((item) => item.kind === 'comment')!;
    if (card.kind !== 'comment') return;
    expect(commentInitials(card.comment)).toBe('AL');
  });

  test('a thread reports its replies, not just each child its parent', () => {
    const items = collectReviewItems({
      storyPart: part,
      commentsPart: commentsPart(
        comment('0', 'parent', 'A0000000') + comment('1', 'reply', 'B0000000')
      ),
      commentsExtendedPart: extendedPart(
        '<w15:commentEx w15:paraId="A0000000" w15:done="0"/>' +
          '<w15:commentEx w15:paraId="B0000000" w15:paraIdParent="A0000000" w15:done="0"/>'
      ),
    });
    const parent = items.find((item) => item.kind === 'comment' && item.id === '0')!;
    const reply = items.find((item) => item.kind === 'comment' && item.id === '1')!;
    if (parent.kind !== 'comment' || reply.kind !== 'comment') return;
    expect(parent.replyIds).toEqual(['1']);
    expect(reply.parentId).toBe('0');
  });
});

describe('threading when the file does not spell it with w15', () => {
  // Both ranges cover exactly the same characters: the shape Word gives a reply, and all that
  // survives a tool that drops `commentsExtended.xml`.
  const coincident = story(
    `<w:p>${run('AB')}${cStart('0')}${cStart('1')}${run('CD')}${cEnd('1')}${cEnd('0')}</w:p>`
  );
  // Comment 1 covers one word inside comment 0's sentence. Nested, but not a thread.
  const nested = story(
    `<w:p>${run('AB')}${cStart('0')}${run('CD')}${cStart('1')}${run('EF')}` +
      `${cEnd('1')}${run('GH')}${cEnd('0')}</w:p>`
  );

  test('`@w16cid:parentId` on the comment threads it', () => {
    const items = collectReviewItems({
      storyPart: story(`<w:p>${run('AB')}${cStart('0')}${run('CD')}${cEnd('0')}</w:p>`),
      commentsPart: commentsPart(
        comment('0', 'parent') +
          `<w:comment xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"` +
          ` w:id="1" w:author="QA Reviewer" w:date="D" w16cid:parentId="0">` +
          `<w:p>${run('reply')}</w:p></w:comment>`
      ),
    });
    const parent = items.find((item) => item.kind === 'comment' && item.id === '0')!;
    const reply = items.find((item) => item.kind === 'comment' && item.id === '1')!;
    if (parent.kind !== 'comment' || reply.kind !== 'comment') return;
    expect(parent.replyIds).toEqual(['1']);
    expect(reply.parentId).toBe('0');
  });

  test('a second comment on exactly the same characters is read as a reply', () => {
    const items = collectReviewItems({
      storyPart: coincident,
      commentsPart: commentsPart(comment('0', 'parent') + comment('1', 'reply')),
    });
    const parent = items.find((item) => item.kind === 'comment' && item.id === '0')!;
    const reply = items.find((item) => item.kind === 'comment' && item.id === '1')!;
    if (parent.kind !== 'comment' || reply.kind !== 'comment') return;
    expect(parent.replyIds).toEqual(['1']);
    expect(reply.parentId).toBe('0');
  });

  test('a comment on a NARROWER range inside another stays independent', () => {
    // The case the pane must not get wrong: commenting on a word inside a commented sentence
    // is a new remark, not a reply, and burying it in someone else's thread hides it.
    const items = collectReviewItems({
      storyPart: nested,
      commentsPart: commentsPart(comment('0', 'sentence') + comment('1', 'one word')),
    });
    const parent = items.find((item) => item.kind === 'comment' && item.id === '0')!;
    const inner = items.find((item) => item.kind === 'comment' && item.id === '1')!;
    if (parent.kind !== 'comment' || inner.kind !== 'comment') return;
    expect(inner.parentId).toBeUndefined();
    expect(parent.replyIds).toEqual([]);
  });

  test('coincidence never overrides what the file states outright', () => {
    // `commentsExtended.xml` gives both a record and neither a parent: two top-level comments
    // on the same span. Inference must stay quiet.
    const items = collectReviewItems({
      storyPart: coincident,
      commentsPart: commentsPart(
        comment('0', 'first', 'A0000000') + comment('1', 'second', 'B0000000')
      ),
      commentsExtendedPart: extendedPart(
        '<w15:commentEx w15:paraId="A0000000" w15:done="0"/>' +
          '<w15:commentEx w15:paraId="B0000000" w15:done="0"/>'
      ),
    });
    const second = items.find((item) => item.kind === 'comment' && item.id === '1')!;
    if (second.kind !== 'comment') return;
    expect(second.parentId).toBeUndefined();
  });

  test('an orphaned range never matches another orphan', () => {
    // Two comments the file gave no usable range. Both collapse to the same position, which
    // must not be read as them sharing a span.
    const items = collectReviewItems({
      storyPart: story(`<w:p>${run('AB')}${cEnd('0')}${cEnd('1')}</w:p>`),
      commentsPart: commentsPart(comment('0', 'one') + comment('1', 'two')),
    });
    const parents = items
      .filter((item) => item.kind === 'comment')
      .map((item) => (item.kind === 'comment' ? item.parentId : undefined));
    expect(parents).toEqual([undefined, undefined]);
  });

  test('a parent id naming a comment the file never defined is dropped', () => {
    const items = collectReviewItems({
      storyPart: story(`<w:p>${cStart('1')}${run('AB')}${cEnd('1')}</w:p>`),
      commentsPart: commentsPart(
        `<w:comment xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"` +
          ` w:id="1" w:author="QA Reviewer" w:date="D" w16cid:parentId="99">` +
          `<w:p>${run('orphan reply')}</w:p></w:comment>`
      ),
    });
    const only = items.find((item) => item.kind === 'comment')!;
    if (only.kind !== 'comment') return;
    // Otherwise the rail's top-level filter would hide it and the remark would vanish.
    expect(only.parentId).toBeUndefined();
  });

  test('a thread cycle leaves both cards top-level rather than hiding both', () => {
    const cid = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';
    const items = collectReviewItems({
      storyPart: story(`<w:p>${cStart('0')}${run('AB')}${cEnd('0')}</w:p>`),
      commentsPart: commentsPart(
        `<w:comment xmlns:w16cid="${cid}" w:id="0" w:author="A" w:date="D" w16cid:parentId="1">` +
          `<w:p>${run('one')}</w:p></w:comment>` +
          `<w:comment xmlns:w16cid="${cid}" w:id="1" w:author="B" w:date="D" w16cid:parentId="0">` +
          `<w:p>${run('two')}</w:p></w:comment>`
      ),
    });
    const parents = items
      .filter((item) => item.kind === 'comment')
      .map((item) => (item.kind === 'comment' ? item.parentId : undefined));
    expect(parents.filter((entry) => entry !== undefined)).toHaveLength(1);
  });
});

describe('caret activation', () => {
  const part = story(
    `<w:p>${run('AB')}${cStart('0')}${run('CDE')}${cEnd('0')}${run('FG')}${ins('7', run('HI'))}</w:p>`
  );
  const items = collectReviewItems({
    storyPart: part,
    commentsPart: commentsPart(comment('0', 'a remark', 'A0000000')),
  });
  const order = paragraphOrderOfPart(part);
  const paragraphId = [...order.keys()][0]!;
  const at = (offset: number) => activeReviewItem(items, { paragraphId, offset }, order);

  test('the caret inside a commented range activates that comment', () => {
    const active = at(3);
    expect(active?.kind === 'comment' && active.id).toBe('0');
  });

  test('the caret at the trailing boundary still activates it', () => {
    expect(at(5)?.kind).toBe('comment');
  });

  test('the caret outside every range activates nothing', () => {
    expect(at(6)).toBeNull();
  });

  test('a resolved comment does not steal activation', () => {
    const resolved = collectReviewItems({
      storyPart: part,
      commentsPart: commentsPart(comment('0', 'settled', 'A0000000')),
      commentsExtendedPart: extendedPart('<w15:commentEx w15:paraId="A0000000" w15:done="1"/>'),
    });
    expect(activeReviewItem(resolved, { paragraphId, offset: 3 }, order)).toBeNull();
  });

  test('a comment WRAPPING a revision is still reachable', () => {
    // Only the tightest range used to be returned, so the comment — the question waiting on
    // the reader — could not be reached from anywhere inside the revision it covered.
    const wrapped = story(
      `<w:p>${cStart('0')}${run('aa ')}${ins('7', run('bb'))}${run(' cc')}${cEnd('0')}</w:p>`
    );
    const wrappedItems = collectReviewItems({
      storyPart: wrapped,
      commentsPart: commentsPart(comment('0', 'covers it all')),
    });
    const wrappedOrder = paragraphOrderOfPart(wrapped);
    const wrappedParagraph = [...wrappedOrder.keys()][0]!;
    const covering = reviewItemsAt(
      wrappedItems,
      { paragraphId: wrappedParagraph, offset: 4 },
      wrappedOrder
    );
    expect(covering.map((item) => item.kind)).toEqual(['revision', 'comment']);
  });

  test('a revision spanning paragraphs still activates', () => {
    // A cross-paragraph range used to score a sentinel width that lost every comparison, so
    // the caret inside a multi-paragraph insertion activated nothing at all.
    const spanning = story(
      `<w:p>${ins('9', run('first half'))}</w:p><w:p>${ins('9', run('second half'))}</w:p>`
    );
    const spanningItems = collectReviewItems({ storyPart: spanning });
    const spanningOrder = paragraphOrderOfPart(spanning);
    const second = [...spanningOrder.keys()][1]!;
    expect(
      activeReviewItem(spanningItems, { paragraphId: second, offset: 3 }, spanningOrder)
    ).not.toBeNull();
  });
});

describe('against the tracked fixture', () => {
  test('every revision in a real document is listed, structural ones included', () => {
    const bytes = new Uint8Array(
      readFileSync(resolve(import.meta.dir, '../../../../e2e/fixtures/list-pagination-break.docx'))
    );
    const pkg = readOoxmlPackage(bytes);
    if (!pkg.ok) throw new Error(pkg.reason);
    const items = revisionItemsOf(pkg.package.parts.get('/word/document.xml')!);
    expect(items.length).toBeGreaterThan(100);
    const kinds = new Set(items.map((item) => item.revisionKind));
    expect(kinds.has('insert')).toBe(true);
    expect(kinds.has('delete')).toBe(true);
    expect(kinds.has('format')).toBe(true);
    expect(kinds.has('structural')).toBe(true);
    // Complete row revisions are actionable; unsupported structural kinds remain in the queue.
    expect(
      items.filter((item) => item.revisionKind === 'structural').some((item) => !item.readOnly)
    ).toBe(true);
  });
});

describe('where a card sits', () => {
  const page = (index: number, contentY: number, fragments: unknown[]) => ({
    index,
    contentBox: { y: contentY },
    fragments,
  });
  const paragraph = (id: string, y: number, lines: { end: number; y: number }[]) => ({
    paragraphId: id,
    box: { y },
    lines: lines.map((line) => ({ range: { end: line.end }, box: { y: line.y } })),
  });

  const comment = (paragraphId: string, offset: number): ReviewItem => ({
    kind: 'comment',
    id: 'c1',
    comment: { id: 'c1', author: 'Ada', blocks: [] } as never,
    range: {
      partName: '/word/document.xml',
      start: { paragraphId, offset },
      end: { paragraphId, offset: offset + 4 },
    },
    resolved: false,
    replyIds: [],
    orphaned: false,
  });

  test('the anchor is absolute in the sheet, not relative to its page', () => {
    // The trap this exists for: a fragment's box is measured from the page CONTENT box, so
    // the first paragraph of every page has y = 0. Reporting that as the anchor stacked
    // every card from page two onwards at the top of the rail.
    const layout = {
      pages: [
        page(0, 72, [paragraph('p1', 0, [{ end: 10, y: 0 }])]),
        page(1, 888, [paragraph('p2', 0, [{ end: 10, y: 0 }])]),
      ],
    };
    const index = reviewAnchorIndex(
      layout,
      (entry) => entry.fragments as ReturnType<typeof paragraph>[]
    );

    expect(reviewItemGeometry(comment('p1', 0), index)).toEqual({ pageIndex: 0, y: 72 });
    expect(reviewItemGeometry(comment('p2', 0), index)).toEqual({ pageIndex: 1, y: 888 });
  });

  test('a card sits beside the LINE its range starts on, not the paragraph top', () => {
    const layout = {
      pages: [
        page(0, 72, [
          paragraph('p1', 0, [
            { end: 20, y: 0 },
            { end: 40, y: 14 },
            { end: 60, y: 28 },
          ]),
        ]),
      ],
    };
    const index = reviewAnchorIndex(
      layout,
      (entry) => entry.fragments as ReturnType<typeof paragraph>[]
    );

    expect(reviewItemGeometry(comment('p1', 45), index)).toEqual({ pageIndex: 0, y: 100 });
  });
});

// Offsets come from `paragraphOffsetIndex` — `segmentsOf`'s own walk — rather than from a
// private character count per module. These are the cases where the private counts and the
// authority disagreed, and every one of them is markup Word writes.
describe('the offset model has ONE authority', () => {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const link = (text: string, id = 'rId9') =>
    `<w:hyperlink r:id="${id}" xmlns:r="${R}">${run(text)}</w:hyperlink>`;

  test('a comment after a hyperlink anchors past the link, not short by its length', () => {
    const part = story(`<w:p>${link('anthropic')}${cStart('1')}${run('here')}${cEnd('1')}</w:p>`);
    const items = collectReviewItems({
      storyPart: part,
      commentsPart: commentsPart(comment('1', 'on the word here')),
    });
    const item = items.find((entry) => entry.kind === 'comment')!;
    expect(item.kind === 'comment' && item.orphaned).toBe(false);
    // "anthropic" is nine characters of ordinary paragraph text; skipping the container
    // anchored this comment at 0 and reported it over the link instead.
    expect(item.kind === 'comment' && item.range).toEqual({
      partName: '/word/document.xml',
      start: { paragraphId: expect.any(String), offset: 9 },
      end: { paragraphId: expect.any(String), offset: 13 },
    });
  });

  test('markers written INSIDE a hyperlink still yield an anchor', () => {
    // What Word writes when you comment on link text: the markers go inside `w:hyperlink`.
    const part = story(
      `<w:p><w:hyperlink r:id="rId9" xmlns:r="${R}">` +
        `${cStart('1')}${run('link')}${cEnd('1')}</w:hyperlink></w:p>`
    );
    const item = collectReviewItems({
      storyPart: part,
      commentsPart: commentsPart(comment('1', 'on the link')),
    }).find((entry) => entry.kind === 'comment')!;
    // Not descending into the link found neither marker, so the comment reported orphaned.
    expect(item.kind === 'comment' && item.orphaned).toBe(false);
    expect(item.kind === 'comment' && item.range?.end.offset).toBe(4);
  });

  test('two comments on two ADJACENT links are not threaded into one card', () => {
    const part = story(
      `<w:p>${cStart('1')}${link('alpha')}${cEnd('1')}` +
        `${cStart('2')}${link('beta', 'rId10')}${cEnd('2')}</w:p>`
    );
    const items = collectReviewItems({
      storyPart: part,
      commentsPart: commentsPart(comment('1', 'first') + comment('2', 'second')),
    });
    const comments = items.filter((entry) => entry.kind === 'comment');
    expect(comments).toHaveLength(2);
    // Each anchors over its own link. Collapsed to a zero-width anchor at the same offset,
    // the coincidence rule read them as one thread and put two authors in one card.
    for (const entry of comments) {
      expect(entry.kind === 'comment' && entry.parentId).toBeUndefined();
    }
  });

  test('a ZERO-WIDTH range is never evidence of a thread', () => {
    // Both ranges cover nothing, at the same offset. That is a coincidence of position and
    // says nothing about the comments — the rule needs characters to argue from.
    const part = story(
      `<w:p>${cStart('1')}${cEnd('1')}${cStart('2')}${cEnd('2')}${run('x')}</w:p>`
    );
    const comments = collectReviewItems({
      storyPart: part,
      commentsPart: commentsPart(comment('1', 'first') + comment('2', 'second')),
    }).filter((entry) => entry.kind === 'comment');
    for (const entry of comments) {
      expect(entry.kind === 'comment' && entry.parentId).toBeUndefined();
    }
  });

  test('a tracked FORMAT change anchors over the run it decorates', () => {
    const part = story(
      `<w:p>${run('before ')}<w:r><w:rPr><w:b/>` +
        `<w:rPrChange w:id="5" w:author="QA" w:date="D"><w:rPr/></w:rPrChange></w:rPr>` +
        `<w:t>bolded</w:t></w:r></w:p>`
    );
    const item = revisionsOf(collectReviewItems({ storyPart: part }))[0]!;
    expect(item.revisionKind).toBe('format');
    // `locateSites` used to stop at the run, so this card had no range at all: it sorted to
    // the end of the rail, painted no band, and the caret in it activated nothing.
    expect(item.ranges).toHaveLength(1);
    expect(item.ranges[0]!.start.offset).toBe(7);
    expect(item.ranges[0]!.end.offset).toBe(13);
  });

  test('a revision in a paragraph holding a note reference reports the true range', () => {
    const part = story(
      `<w:p>${run('ab')}<w:r><w:footnoteReference w:id="1"/></w:r>` + `${ins('9', run('cd'))}</w:p>`
    );
    const item = revisionsOf(collectReviewItems({ storyPart: part }))[0]!;
    // The reference measures one unit, so the insertion starts at 3. Counting it as nothing
    // put the card's range — and the highlight band — one character early.
    expect(item.ranges[0]!.start.offset).toBe(3);
    expect(item.ranges[0]!.end.offset).toBe(5);
  });
});
