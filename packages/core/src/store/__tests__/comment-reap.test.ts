// Deleting the words a comment covers deletes the comment — the way Word does it.
//
// The failure this pins: the rail went on drawing a card for a remark whose text was gone, with
// an author, a date and nothing under it, and saving produced a file whose `w:comment` pointed at
// characters the document no longer held. Two halves had to be wrong for that: the emptied
// revision wrapper the untracked delete left behind, and the comment record nothing reaped.
//
// The reap is deliberately narrow, and the last two tests are what keeps it that way: a comment
// the FILE shipped with no range is left exactly as found, and shortening a range is not
// deleting it.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addComment,
  commentAnchorsOfStory,
  commentPartNameOf,
  commentsOfPart,
  readOoxmlPackage,
  removeNode,
  TreeDocumentStore,
  TreePackageStore,
  withPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '../index.ts';

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

function fixture(): OoxmlPackage {
  const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!pkg.ok) throw new Error(pkg.reason);
  return pkg.package;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += textOf(child);
  return text;
}

/** A body paragraph holding at least `length` characters, and how many it holds. */
function paragraphWithText(story: OoxmlPart, length: number): { id: string; length: number } {
  const body = story.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  for (const block of body.children) {
    if (block.kind !== 'paragraph') continue;
    const text = textOf(block);
    if (text.length >= length) return { id: block.id, length: text.length };
  }
  throw new Error('no paragraph long enough');
}

interface Probe {
  readonly pkg: OoxmlPackage;
  readonly paragraphId: string;
  readonly length: number;
  /** `w:id` of the comment this fixture just added — the fixture ships four of its own. */
  readonly commentId: string;
}

/** The fixture plus one comment over `[0, 5)` of a body paragraph. */
function withOneComment(): Probe {
  const loaded = fixture();
  const store = new TreeDocumentStore(loaded, loaded.mainDocumentPart);
  const target = paragraphWithText(store.part, 20);
  const added = addComment(store, {
    anchor: { paragraphId: target.id, start: 0, end: 5 },
    author: 'Reap Probe',
    initials: 'RP',
    date: '2026-08-05T10:00:00Z',
    text: 'Check this claim.',
  });
  if (!added.ok) throw new Error(`addComment refused: ${added.reason}`);
  return {
    pkg: store.package,
    paragraphId: target.id,
    length: target.length,
    commentId: added.commentId,
  };
}

function commentIds(pkg: OoxmlPackage, storyPartName: string): string[] {
  const part = pkg.parts.get(commentPartNameOf(pkg, storyPartName));
  return part ? commentsOfPart(part).map((comment) => comment.id) : [];
}

/** Node ids of every comment marker in a story naming `commentId`. */
function markersFor(part: OoxmlPart, commentId: string): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (
      node.kind === 'commentRangeStart' ||
      node.kind === 'commentRangeEnd' ||
      node.kind === 'commentReference'
    ) {
      const id = node.attributes.find(
        (entry) => entry.localName === 'id' && entry.namespaceUri === WML_NAMESPACE_URI
      );
      if (id?.value === commentId) found.push(node.id);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

describe('a comment dies with the words it covered', () => {
  test('deleting the whole commented range removes the record, its markers and its anchor', () => {
    const { pkg, paragraphId, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    const store = new TreePackageStore(pkg, pkg.parts.get(mainName)!);
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);

    const result = store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: 0, end: 5 });
    });

    expect(result.ok).toBe(true);
    const after = store.currentPackage();
    expect(commentIds(after, mainName)).not.toContain(commentId);
    // Markers go with the record. A `commentRangeEnd` naming a comment the package cannot
    // resolve is exactly the half-deleted state the reap exists to prevent.
    expect(markersFor(after.parts.get(mainName)!, commentId)).toEqual([]);
    expect(
      commentAnchorsOfStory(after.parts.get(mainName)!).some(
        (anchor) => anchor.commentId === commentId
      )
    ).toBe(false);
    // The fixture's OWN four comments are untouched: nothing about them was deleted.
    expect(commentIds(after, mainName).length).toBe(4);
  });

  test('undo puts the words and the remark back together', () => {
    const { pkg, paragraphId, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    const store = new TreePackageStore(pkg, pkg.parts.get(mainName)!);

    store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: 0, end: 5 });
    });
    expect(commentIds(store.currentPackage(), mainName)).not.toContain(commentId);

    expect(store.undo()).not.toBeNull();
    // ONE undo, not two. The reap rides the same package pointer as the deletion, so a reader
    // never sees the intermediate state where the text is back and the comment is not.
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);
    expect(markersFor(store.currentPackage().parts.get(mainName)!, commentId).length).toBe(3);
  });

  test('shortening a range keeps the comment', () => {
    const { pkg, paragraphId, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    const store = new TreePackageStore(pkg, pkg.parts.get(mainName)!);

    const result = store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: 0, end: 2 });
    });

    expect(result.ok).toBe(true);
    // Three characters of the five still carry the remark, so there is still something to
    // remark on. Reaping here would delete a comment on text the reader can still see.
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);
  });

  test('an edit elsewhere leaves a comment the file shipped orphaned exactly as found', () => {
    const { pkg, paragraphId, length, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    // Strand it the way a foreign producer can: drop the start marker, leaving an end with
    // nothing before it. Stranded in the PACKAGE, before any store opens it, so this is a file
    // that ARRIVED this way rather than an edit the engine made.
    const story = pkg.parts.get(mainName)!;
    const start = markersFor(story, commentId)[0];
    if (start === undefined) throw new Error('no start marker to strip');
    const stripped = removeNode(story, start, { deferValidation: true });
    if (!stripped.ok) throw new Error('could not strand the comment');
    expect(
      commentAnchorsOfStory(stripped.part).some(
        (anchor) => anchor.commentId === commentId && anchor.orphaned
      )
    ).toBe(true);

    const store = new TreePackageStore(withPart(pkg, stripped.part), stripped.part);
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);

    // Now edit somewhere the comment never was. The remark is already rangeless, so the reap
    // must not read that as "this edit emptied it" — a file's own orphan is not ours to delete.
    const result = store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: length - 2, end: length - 1 });
    });
    expect(result.ok).toBe(true);
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);
  });
});
