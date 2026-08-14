// Adversarial bounds and isolation for story-owned comment deletion.

import { describe, expect, test } from 'bun:test';
import {
  commentsOfPart,
  removeNode,
  serializeOoxmlPart,
  withPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPackage,
} from '../index.ts';
import {
  cascadeEmptiedComments,
  deleteCommentReply,
  deleteCommentThread,
  deleteCommentThreadInStory,
  deleteCommentThreadWithBudget,
} from '../package/comment-lifecycle.ts';
import {
  attribute,
  createCommentScanBudget,
  MAX_COMMENT_SCAN_PARTS,
  W15_NAMESPACE_URI,
  W16CID_NAMESPACE_URI,
} from '../package/comment-lifecycle-scan.ts';
import {
  commentIds,
  keyedLocalNames,
  loadDuplicateBodyHeader,
  loadIsolatedStoryComments,
  loadNestedReplyComments,
  loadSharedNestedReplyComments,
  loadUniqueBodyComment,
  loadWrongTypedConventionalComments,
  markersFor,
  prependXmlPadding,
  textOf,
} from './comment-lifecycle-test-support.ts';

describe('comment deletion scans fail closed and stay owner-scoped', () => {
  test('a marker behind more than 512 padding parts preserves comments.xml', () => {
    const base = loadUniqueBodyComment();
    const pkg = prependXmlPadding(base, MAX_COMMENT_SCAN_PARTS);
    const main = pkg.mainDocumentPart;
    const stripped = deleteCommentThread(pkg, '1');
    if (stripped === null) throw new Error('deletion refused');
    expect(markersFor(stripped.parts.get(main)!, '1')).toEqual([]);
    expect(textOf(stripped.parts.get('/word/comments.xml')!.root)).toContain('only');
  });

  test('a single part that exhausts the node budget preserves comments.xml', () => {
    const pkg = loadUniqueBodyComment();
    const main = pkg.mainDocumentPart;
    const stripped = deleteCommentThreadWithBudget(
      pkg,
      '1',
      { storyPartName: main },
      createCommentScanBudget(8)
    );
    if (stripped === null) throw new Error('deletion refused');
    expect(markersFor(stripped.parts.get(main)!, '1').length).toBe(3);
    expect(textOf(stripped.parts.get('/word/comments.xml')!.root)).toContain('only');
  });

  test('owner markers are all three or none under every node budget', () => {
    const pkg = loadUniqueBodyComment();
    const main = pkg.mainDocumentPart;
    expect(markersFor(pkg.parts.get(main)!, '1').length).toBe(3);
    for (const maxVisited of [1, 2, 3, 4, 8, 16, 32, 64, 256, 50_000]) {
      const result = deleteCommentThreadWithBudget(
        pkg,
        '1',
        { storyPartName: main },
        createCommentScanBudget(maxVisited)
      );
      if (result === null) continue;
      const count = markersFor(result.parts.get(main)!, '1').length;
      expect(count === 0 || count === 3).toBe(true);
    }
  });

  test('separate comments and extension parts with colliding ids stay isolated', () => {
    const pkg = loadIsolatedStoryComments();
    const main = pkg.mainDocumentPart;
    const stripped = deleteCommentThreadInStory(pkg, '1', { storyPartName: main });
    if (stripped === null) throw new Error('deletion refused');
    expect(markersFor(stripped.parts.get(main)!, '1')).toEqual([]);
    expect(markersFor(stripped.parts.get('/word/header1.xml')!, '1').length).toBe(3);
    expect(textOf(stripped.parts.get('/word/comments.xml')!.root)).not.toContain('body-rec');
    expect(textOf(stripped.parts.get('/word/comments-hf.xml')!.root)).toContain('header-rec');
    expect(keyedLocalNames(stripped.parts.get('/word/commentsExtended.xml'))).toEqual([]);
    expect(keyedLocalNames(stripped.parts.get('/word/commentsExtended-hf.xml'))).toEqual([
      'commentEx',
    ]);
    expect(keyedLocalNames(stripped.parts.get('/word/commentsIds.xml'))).toEqual([]);
    expect(keyedLocalNames(stripped.parts.get('/word/commentsIds-hf.xml'))).toEqual(['commentId']);
  });

  test('a wrong-typed conventional comments.xml is not a comments part', () => {
    const pkg = loadWrongTypedConventionalComments();
    const main = pkg.mainDocumentPart;
    const stripped = deleteCommentThread(pkg, '1', { storyPartName: main });
    if (stripped === null) throw new Error('deletion refused');
    expect(markersFor(stripped.parts.get(main)!, '1')).toEqual([]);
    expect(commentsOfPart(stripped.parts.get('/word/comments2.xml')!).map((c) => c.id)).toEqual([]);
    expect(textOf(stripped.parts.get('/word/comments.xml')!.root)).toContain('decoy');
  });

  test('cascadeEmptiedComments without an owner defaults to the main story', () => {
    const before = loadDuplicateBodyHeader();
    const main = before.mainDocumentPart;
    let story = before.parts.get(main)!;
    for (const id of markersFor(story, '1')) {
      const removed = removeNode(story, id, { deferValidation: true });
      if (!removed.ok) throw new Error('could not empty the body range');
      story = removed.part;
    }
    const after = withPart(before, story);
    const reaped = cascadeEmptiedComments(before, after);
    if (reaped === null) throw new Error('cascade refused');
    expect(markersFor(reaped.parts.get(main)!, '1')).toEqual([]);
    expect(markersFor(reaped.parts.get('/word/header1.xml')!, '1').length).toBe(3);
    expect(commentIds(reaped, main)).toContain('1');
  });
});

function firstAttr(
  root: OoxmlNode,
  match: (node: OoxmlNode) => boolean,
  ns: string,
  name: string
): string | undefined {
  let found: string | undefined;
  const visit = (node: OoxmlNode): void => {
    if (found !== undefined || node.kind === 'textValue') return;
    if (match(node)) {
      found = attribute(node, ns, name);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function parentIdOf(pkg: OoxmlPackage, commentId: string): string | undefined {
  return firstAttr(
    pkg.parts.get('/word/comments.xml')!.root,
    (node) => node.kind === 'comment' && attribute(node, WML_NAMESPACE_URI, 'id') === commentId,
    W16CID_NAMESPACE_URI,
    'parentId'
  );
}

function paraIdParentOf(pkg: OoxmlPackage, paraId: string): string | undefined {
  return firstAttr(
    pkg.parts.get('/word/commentsExtended.xml')!.root,
    (node) =>
      node.kind !== 'textValue' &&
      node.localName === 'commentEx' &&
      attribute(node, W15_NAMESPACE_URI, 'paraId') === paraId,
    W15_NAMESPACE_URI,
    'paraIdParent'
  );
}

describe('reply deletion is atomic under truncation and reparents when complete', () => {
  test('remaining-marker overflow leaves the nested thread untouched', () => {
    const base = loadNestedReplyComments();
    const pkg = prependXmlPadding(base, MAX_COMMENT_SCAN_PARTS);
    const main = pkg.mainDocumentPart;
    const result = deleteCommentReply(pkg, '2', '1', { storyPartName: main });
    if (result === null) throw new Error('deletion refused');
    expect(result).toBe(pkg);
    expect(commentIds(result, main)).toEqual(['1', '2', '4']);
    expect(markersFor(result.parts.get(main)!, '1').length).toBe(3);
    expect(markersFor(result.parts.get(main)!, '2').length).toBe(3);
    expect(parentIdOf(result, '4')).toBe('2');
    expect(paraIdParentOf(result, '44444444')).toBe('22222222');
    expect(keyedLocalNames(result.parts.get('/word/commentsExtended.xml'))).toEqual([
      'commentEx',
      'commentEx',
      'commentEx',
    ]);
    expect(keyedLocalNames(result.parts.get('/word/commentsIds.xml'))).toEqual([
      'commentId',
      'commentId',
      'commentId',
    ]);
  });

  test('a completed nested-reply delete reparents the descendant to the parent', () => {
    const pkg = loadNestedReplyComments();
    const main = pkg.mainDocumentPart;
    const result = deleteCommentReply(pkg, '2', '1', { storyPartName: main });
    if (result === null) throw new Error('deletion refused');
    expect(commentIds(result, main)).toEqual(['1', '4']);
    expect(markersFor(result.parts.get(main)!, '2')).toEqual([]);
    expect(markersFor(result.parts.get(main)!, '1').length).toBe(3);
    expect(parentIdOf(result, '4')).toBe('1');
    expect(paraIdParentOf(result, '44444444')).toBe('11111111');
    expect(paraIdParentOf(result, '22222222')).toBeUndefined();
    expect(keyedLocalNames(result.parts.get('/word/commentsExtended.xml'))).toEqual([
      'commentEx',
      'commentEx',
    ]);
    expect(keyedLocalNames(result.parts.get('/word/commentsIds.xml'))).toEqual([
      'commentId',
      'commentId',
    ]);
    expect(textOf(result.parts.get('/word/comments.xml')!.root)).toContain('nested');
    expect(textOf(result.parts.get('/word/comments.xml')!.root)).not.toContain('reply');
  });

  test('a shared reply id strips only the owning story’s markers', () => {
    const pkg = loadSharedNestedReplyComments();
    const main = pkg.mainDocumentPart;
    const header = pkg.parts.get('/word/header1.xml')!;
    const commentsXml = serializeOoxmlPart(pkg.parts.get('/word/comments.xml')!);
    const extendedXml = serializeOoxmlPart(pkg.parts.get('/word/commentsExtended.xml')!);
    const idsXml = serializeOoxmlPart(pkg.parts.get('/word/commentsIds.xml')!);
    const headerXml = serializeOoxmlPart(header);
    const result = deleteCommentReply(pkg, '2', '1', { storyPartName: main });
    if (result === null) throw new Error('deletion refused');
    expect(markersFor(result.parts.get(main)!, '2')).toEqual([]);
    expect(markersFor(result.parts.get(main)!, '1').length).toBe(3);
    expect(serializeOoxmlPart(result.parts.get('/word/header1.xml')!)).toBe(headerXml);
    expect(serializeOoxmlPart(result.parts.get('/word/comments.xml')!)).toBe(commentsXml);
    expect(serializeOoxmlPart(result.parts.get('/word/commentsExtended.xml')!)).toBe(extendedXml);
    expect(serializeOoxmlPart(result.parts.get('/word/commentsIds.xml')!)).toBe(idsXml);
    expect(commentIds(result, main)).toEqual(['1', '2', '4']);
    expect(parentIdOf(result, '4')).toBe('2');
    expect(paraIdParentOf(result, '44444444')).toBe('22222222');
    expect(markersFor(result.parts.get('/word/header1.xml')!, '2').length).toBe(3);
  });
});
