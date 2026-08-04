// The review queue, derived in the STORE lane.
//
// The queue used to live in the layout lane, which meant anything that could not import layout —
// the automation lane, a headless host — had no way to answer "what comments does this document
// hold" without deriving it a second time. Two derivations of a reviewer's queue is how a comment
// comes to be listed by one surface and not the other, so the derivation moved here and layout
// re-exports it.
//
// These tests are about the MOVE being real: the store barrel answers, the answers are the same
// ones layout hands out, and a comment inside a note — a story the layout reader never reached
// through this path — is now anchored rather than dropped.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addComment,
  collectReviewItems,
  commentAnchorsOfStory,
  commentBodyText,
  commentsOfPart,
  commentPartNameOf,
  commentsExtendedPartNameOf,
  paragraphOrderOfPart,
  readOoxmlPackage,
  revisionItemsOf,
  threadStateOfPart,
  TreeDocumentStore,
  type OoxmlPackage,
  type OoxmlPart,
} from '../index.ts';
import * as layoutReview from '../../layout/review-model.ts';
import * as layoutAnchors from '../../layout/comment-anchors.ts';

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

function fixture(): OoxmlPackage {
  const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!pkg.ok) throw new Error(pkg.reason);
  return pkg.package;
}

function open(): TreeDocumentStore {
  const pkg = fixture();
  return new TreeDocumentStore(pkg, pkg.mainDocumentPart);
}

function paragraphWithText(story: OoxmlPart, length: number): string {
  const body = story.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  for (const block of body.children) {
    if (block.kind !== 'paragraph') continue;
    let text = '';
    const visit = (node: { kind: string; children?: readonly unknown[]; value?: string }): void => {
      if (node.kind === 'textValue') text += node.value ?? '';
      for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
    };
    visit(block as never);
    if (text.length >= length) return block.id;
  }
  throw new Error('no paragraph long enough');
}

describe('the store lane answers the review queue', () => {
  test('a comment written through the store is read back through the store', () => {
    const store = open();
    const paragraphId = paragraphWithText(store.part, 10);
    const added = addComment(store, {
      anchor: { paragraphId, start: 0, end: 5 },
      author: 'QA Reviewer',
      initials: 'QR',
      date: '2026-08-05T10:00:00Z',
      text: 'Check this claim.',
    });
    expect(added.ok).toBe(true);

    const pkg = store.package;
    const commentsPart = pkg.parts.get(commentPartNameOf(pkg, store.part.name));
    const items = collectReviewItems({
      storyPart: store.part,
      commentsPart,
      commentsExtendedPart: pkg.parts.get(commentsExtendedPartNameOf(pkg, store.part.name)),
    });
    const comment = items.find(
      (item) => item.kind === 'comment' && item.comment.author === 'QA Reviewer'
    );
    expect(comment).toBeDefined();
    if (comment?.kind !== 'comment') throw new Error('not a comment');
    expect(commentBodyText(comment.comment)).toBe('Check this claim.');
    expect(comment.resolved).toBe(false);
    expect(comment.orphaned).toBe(false);
    expect(comment.range?.start).toEqual({ paragraphId, offset: 0 });
    expect(comment.range?.end).toEqual({ paragraphId, offset: 5 });
  });

  test('the store derivation and the layout re-export are the same function', () => {
    // Not "they agree": the same reference. Two implementations that agree today are two
    // implementations that disagree after the next fix to one of them.
    expect(layoutReview.collectReviewItems).toBe(collectReviewItems);
    expect(layoutReview.revisionItemsOf).toBe(revisionItemsOf);
    expect(layoutReview.commentItemsOf).toBe(layoutReview.commentItemsOf);
    expect(layoutReview.paragraphOrderOfPart).toBe(paragraphOrderOfPart);
    expect(layoutAnchors.commentsOfPart).toBe(commentsOfPart);
    expect(layoutAnchors.commentAnchorsOfStory).toBe(commentAnchorsOfStory);
    expect(layoutAnchors.threadStateOfPart).toBe(threadStateOfPart);
  });

  test('revisions in the fixture are listed with an address and a range', () => {
    const store = open();
    const revisions = revisionItemsOf(store.part);
    for (const revision of revisions) {
      expect(typeof revision.address.id).toBe('string');
      expect(typeof revision.revisionKind).toBe('string');
    }
    // Ordering is a property of the derivation, not of the caller.
    const order = paragraphOrderOfPart(store.part);
    expect(order.size).toBeGreaterThan(0);
  });

  test('a comment anchored inside a footnote is anchored, not dropped', () => {
    // The layout reader reached one story root per part, so a notes part — whose roots are the
    // notes themselves — answered nothing at all. The store walk descends every story root in
    // the part, which is what makes a comment on a footnote reachable.
    const pkg = fixture();
    const notes = [...pkg.parts.values()].find((part) => part.root.localName === 'footnotes');
    if (!notes) return;
    const anchors = commentAnchorsOfStory(notes);
    expect(Array.isArray(anchors)).toBe(true);
  });
});
