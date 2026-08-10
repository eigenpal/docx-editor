/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Adding a comment and replying to one.
//
// The point of these is not that a `w:comment` element appears somewhere. It is that ONE user
// action produces one publication, one undo entry, and a package that still opens — with the
// story, the comment body, the thread link, the relationship and the content type all agreeing
// about a comment that did not exist a moment ago.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TreeDocumentStore,
  addComment,
  commentPartNameOf,
  readOoxmlPackage,
  serializeOoxmlPart,
  writeOoxmlPackage,
  validatePackageInvariants,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
} from '../review/comment-anchors.ts';

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../e2e/fixtures/comprehensive-word-element-test.docx'
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

/** A paragraph with at least `length` characters, so an anchor has room. */
function paragraphWithText(story: OoxmlPart, length: number): { id: string; text: string } {
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
    if (text.length >= length) return { id: block.id, text };
  }
  throw new Error('no paragraph long enough');
}

/** The `w14:paraId` a comment's first paragraph carries, read straight from the XML. */
function paraIdOfCommentInPart(part: Parameters<typeof serializeOoxmlPart>[0], commentId: string) {
  const xml = serializeOoxmlPart(part);
  const comment = xml.split(`<w:comment `).find((chunk) => chunk.includes(`w:id="${commentId}"`));
  return comment?.match(/w14:paraId="([0-9A-Fa-f]{8})"/)?.[1] ?? null;
}

describe('adding a comment', () => {
  test('one call is one publication and one undo entry', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const changes: string[] = [];
    store.subscribe((change) => changes.push(change.commitId));

    const result = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 5 },
      author: 'QA Reviewer',
      initials: 'QR',
      date: '2026-08-03T10:00:00Z',
      text: 'Needs a source.',
    });

    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(store.historyDepth).toBe(1);
  });

  test('the story, the body and the anchor all agree about the new comment', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const added = addComment(store, {
      anchor: { paragraphId: target.id, start: 2, end: 7 },
      author: 'QA Reviewer',
      text: 'Check this.',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const comments = commentsOfPart(store.package.parts.get('/word/comments.xml')!);
    const written = comments.find((comment) => comment.id === added.commentId);
    expect(written?.author).toBe('QA Reviewer');

    const anchor = commentAnchorsOfStory(store.part).find(
      (entry) => entry.commentId === added.commentId
    );
    expect(anchor).toBeDefined();
    expect(anchor?.orphaned).toBe(false);
    // The anchor covers exactly the characters that were asked for, and the markers moved
    // nothing: splitting a run to make room changes no text.
    expect([anchor?.start.offset, anchor?.end.offset]).toEqual([2, 7]);
  });

  test('the comment id is seeded from the document, never from a clock', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    // The fixture already has comments 0..3.
    const added = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 3 },
      author: 'QA',
      text: 'next',
    });
    expect(added.ok && added.commentId).toBe('4');
  });

  test('an author is required, because the schema requires it', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const result = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 3 },
      author: '',
      text: 'no author',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-author');
    expect(store.historyDepth).toBe(0);
  });

  test('no date is written when none is given', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const added = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 3 },
      author: 'QA',
      text: 'undated',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const comments = commentsOfPart(store.package.parts.get('/word/comments.xml')!);
    expect(comments.find((comment) => comment.id === added.commentId)?.date).toBeUndefined();
  });

  test('one undo takes the whole comment back, in every part', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const storyBefore = serializeOoxmlPart(store.part);
    const commentsBefore = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);

    addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 4 },
      author: 'QA',
      text: 'undo me',
    });
    expect(serializeOoxmlPart(store.part)).not.toBe(storyBefore);

    store.undo();
    expect(serializeOoxmlPart(store.part)).toBe(storyBefore);
    expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(commentsBefore);
  });

  test('the written package still opens, and the comment is there when it does', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const added = addComment(store, {
      anchor: { paragraphId: target.id, start: 1, end: 6 },
      author: 'QA Reviewer',
      text: 'survives a round trip',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    expect(validatePackageInvariants(store.package).ok).toBe(true);
    const reopened = readOoxmlPackage(writeOoxmlPackage(store.package));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const comments = commentsOfPart(reopened.package.parts.get('/word/comments.xml')!);
    expect(comments.map((comment) => comment.id)).toContain(added.commentId);
    expect(
      commentsOfPart(reopened.package.parts.get('/word/comments.xml')!).find(
        (comment) => comment.id === added.commentId
      )?.blocks.length
    ).toBe(1);
  });
});

describe('replying', () => {
  test('a reply links to its parent through commentsExtended', () => {
    const store = open();
    const target = paragraphWithText(store.part, 20);

    const parent = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 6 },
      author: 'QA Reviewer',
      text: 'Is this right?',
    });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;

    // No thread part until a thread exists.
    expect(store.package.parts.get('/word/commentsExtended.xml')).toBeUndefined();

    const reply = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 6 },
      author: 'Dev Lead',
      text: 'Yes, confirmed.',
      replyToCommentId: parent.commentId,
    });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;

    const extended = store.package.parts.get('/word/commentsExtended.xml');
    expect(extended).toBeDefined();
    if (!extended) return;

    const comments = commentsOfPart(store.package.parts.get('/word/comments.xml')!);
    const parentParaId = comments.find((comment) => comment.id === parent.commentId)?.paraId;
    const replyParaId = comments.find((comment) => comment.id === reply.commentId)?.paraId;
    expect(parentParaId).toBeDefined();
    expect(replyParaId).toBeDefined();

    const state = threadStateOfPart(extended);
    expect(state.get(parentParaId!.toUpperCase())).toEqual({ done: false });
    expect(state.get(replyParaId!.toUpperCase())?.parentParaId).toBe(parentParaId!.toUpperCase());
    expect(state.size).toBe(2);
  });

  test('creating the thread part is part of the same transaction', () => {
    const store = open();
    const target = paragraphWithText(store.part, 20);
    const parent = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 6 },
      author: 'QA',
      text: 'parent',
    });
    if (!parent.ok) return;

    const depthBefore = store.historyDepth;
    const changes: string[] = [];
    store.subscribe((change) => changes.push(change.commitId));

    addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 6 },
      author: 'Dev',
      text: 'reply',
      replyToCommentId: parent.commentId,
    });

    // The reply created a part, a relationship, a content-type override, a comment body and
    // three story markers. One change, one entry.
    expect(changes).toHaveLength(1);
    expect(store.historyDepth).toBe(depthBefore + 1);
  });

  test('one undo removes the reply, its thread record and the part it created', () => {
    const store = open();
    const target = paragraphWithText(store.part, 20);
    const parent = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 6 },
      author: 'QA',
      text: 'parent',
    });
    if (!parent.ok) return;

    addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 6 },
      author: 'Dev',
      text: 'reply',
      replyToCommentId: parent.commentId,
    });
    expect(store.package.parts.get('/word/commentsExtended.xml')).toBeDefined();

    store.undo();
    expect(store.package.parts.get('/word/commentsExtended.xml')).toBeUndefined();
    expect(
      commentsOfPart(store.package.parts.get('/word/comments.xml')!).map((entry) => entry.id)
    ).not.toContain('5');
  });

  test('a reply to a parent with no paraId mints one for the parent rather than guessing', () => {
    // The fixture's own comments carry no `w14:paraId` — it is an extension, and files from
    // other editors omit it — while `w15:commentsEx` keys the thread by exactly that. Linking
    // by position is what the design refuses, so the parent is STAMPED in the same
    // transaction. Only the comment being replied to is touched; an untouched document is
    // never rewritten on load.
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const result = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 4 },
      author: 'Dev',
      text: 'reply to a comment the file never stamped',
      replyToCommentId: '0',
    });
    expect(result.ok).toBe(true);
    // One undo takes the whole reply back, the parent's new id included.
    expect(store.historyDepth).toBe(1);

    const comments = store.package.parts.get('/word/comments.xml')!;
    const parentParaId = paraIdOfCommentInPart(comments, '0');
    expect(parentParaId).toMatch(/^[0-9A-F]{8}$/);

    // The thread entry names that same id as its parent, which is what makes Word draw the
    // reply under the comment instead of beside it.
    const extended = store.package.parts.get('/word/commentsExtended.xml');
    expect(extended).toBeDefined();
    const state = threadStateOfPart(extended!);
    expect(state.get(parentParaId!)).toEqual({ done: false });
    expect([...state.values()].some((entry) => entry.parentParaId === parentParaId)).toBe(true);
  });

  test('a reply to a comment the part does not hold is refused', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const result = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 4 },
      author: 'Dev',
      text: 'reply to nothing',
      replyToCommentId: 'no-such-comment',
    });
    expect(result.ok).toBe(false);
    expect(store.historyDepth).toBe(0);
  });

  test('a threaded package survives a save and reopen with its thread intact', () => {
    const store = open();
    const target = paragraphWithText(store.part, 20);
    const parent = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 6 },
      author: 'QA',
      text: 'parent',
    });
    if (!parent.ok) return;
    const reply = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 6 },
      author: 'Dev',
      text: 'reply',
      replyToCommentId: parent.commentId,
    });
    if (!reply.ok) return;

    const reopened = readOoxmlPackage(writeOoxmlPackage(store.package));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(validatePackageInvariants(reopened.package).ok).toBe(true);

    const comments = commentsOfPart(reopened.package.parts.get('/word/comments.xml')!);
    const state = threadStateOfPart(reopened.package.parts.get('/word/commentsExtended.xml')!);
    const replyParaId = comments.find((entry) => entry.id === reply.commentId)?.paraId;
    const parentParaId = comments.find((entry) => entry.id === parent.commentId)?.paraId;
    expect(state.get(parentParaId!.toUpperCase())).toEqual({ done: false });
    expect(state.get(replyParaId!.toUpperCase())?.parentParaId).toBe(parentParaId!.toUpperCase());
  });
});

describe('paraId is minted on write and only on write', () => {
  test('a load and save with no comment write adds none', () => {
    const store = open();
    const before = serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!);
    // The fixture has zero `w14:paraId` in its comment part; nothing here should add one.
    expect(before).not.toContain('paraId');
    expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toBe(before);
  });

  test('a written comment carries a well-formed, unique paraId', () => {
    const store = open();
    const target = paragraphWithText(store.part, 10);
    const added = addComment(store, {
      anchor: { paragraphId: target.id, start: 0, end: 4 },
      author: 'QA',
      text: 'minted',
    });
    if (!added.ok) return;
    const comment = commentsOfPart(store.package.parts.get('/word/comments.xml')!).find(
      (entry) => entry.id === added.commentId
    );
    expect(comment?.paraId).toMatch(/^[0-9A-F]{8}$/i);
    expect(comment?.paraId).not.toBe('00000000');
  });
});

// A relationship is a claim a FILE makes, and a `.docx` is a file an attacker wrote.
describe('a crafted comments relationship cannot redirect the write', () => {
  const COMMENTS_REL =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

  test('a comments relationship pointing at a part of another type is ignored', () => {
    const pkg = fixture();
    // `settings.xml` is a real part of the package, declaring the settings content type.
    // Declaring a comments relationship at it is legal XML and is what a crafted package
    // does: without a content-type check the comment body, and everything a reader trusts
    // about it, is written straight into another part.
    const target = [...pkg.parts.keys()].find((name) => name.endsWith('/settings.xml'));
    expect(target).toBeDefined();
    const owner = pkg.mainDocumentPart;
    const crafted: OoxmlPackage = {
      ...pkg,
      relationships: new Map(pkg.relationships).set(owner, [
        // The file's OWN comments relationship, replaced — which is what a crafted package
        // ships, not an extra one appended after a legitimate one.
        ...(pkg.relationships.get(owner) ?? []).filter((record) => record.type !== COMMENTS_REL),
        {
          id: 'rIdEvil',
          ownerPart: owner,
          type: COMMENTS_REL,
          rawTarget: 'settings.xml',
          targetMode: 'Internal' as const,
          order: 9_999,
        },
      ]),
    };

    expect(commentPartNameOf(crafted, owner)).toBe('/word/comments.xml');

    const store = new TreeDocumentStore(crafted, owner);
    const settingsBefore = serializeOoxmlPart(crafted.parts.get(target!)!);
    const anchor = paragraphWithText(store.part, 10);
    const result = addComment(store, {
      anchor: { paragraphId: anchor.id, start: 0, end: 5 },
      author: 'QA Reviewer',
      date: '2026-08-03T10:00:00Z',
      text: 'redirected?',
    });
    expect(result.ok).toBe(true);
    // The settings part is byte-identical: nothing about this write reached it.
    expect(serializeOoxmlPart(store.package.parts.get(target!)!)).toBe(settingsBefore);
    expect(serializeOoxmlPart(store.package.parts.get('/word/comments.xml')!)).toContain(
      'redirected?'
    );
  });

  test('a relationship naming a part the package does not hold is still honoured', () => {
    // The check is on the target's declared TYPE, not on the name. A package whose comment
    // part is simply called something else must keep working, and the part this write is
    // about to create is typed by this write.
    const pkg = fixture();
    const owner = pkg.mainDocumentPart;
    const crafted: OoxmlPackage = {
      ...pkg,
      relationships: new Map(pkg.relationships).set(owner, [
        ...(pkg.relationships.get(owner) ?? []).filter((record) => record.type !== COMMENTS_REL),
        {
          id: 'rIdComments',
          ownerPart: owner,
          type: COMMENTS_REL,
          rawTarget: 'review/comments.xml',
          targetMode: 'Internal' as const,
          order: 9_999,
        },
      ]),
    };
    expect(commentPartNameOf(crafted, owner)).toBe('/word/review/comments.xml');
  });
});
