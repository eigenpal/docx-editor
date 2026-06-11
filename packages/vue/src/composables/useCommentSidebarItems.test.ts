import { describe, test, expect } from 'bun:test';
import { ref } from 'vue';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { TrackedChangeEntry } from '@eigenpal/docx-editor-core/utils/comments';
import { useCommentSidebarItems } from './useCommentSidebarItems';

/**
 * Regression for #773: a reply to a tracked change (a comment whose
 * `parentId === revisionId`) must thread under that change's sidebar item,
 * not surface as a standalone top-level comment. Mirrors React's
 * useCommentSidebarItems grouping.
 */

function comment(id: number, parentId?: number): Comment {
  return {
    id,
    author: 'User',
    content: [{ type: 'paragraph', formatting: {}, content: [] }],
    ...(parentId !== undefined && { parentId }),
  };
}

function change(revisionId: number): TrackedChangeEntry {
  return {
    type: 'insertion',
    text: 'hello',
    author: 'sara.k',
    from: 10,
    to: 15,
    revisionId,
  };
}

describe('useCommentSidebarItems — tracked-change reply threading (#773)', () => {
  test('a reply with parentId === revisionId threads under the tracked-change item', () => {
    const reply = comment(2, 100); // parentId = revisionId of the change below
    const items = useCommentSidebarItems({
      comments: ref<Comment[]>([reply]),
      trackedChanges: ref<TrackedChangeEntry[]>([change(100)]),
    });

    const tc = items.value.find((i) => i.kind === 'tracked-change');
    expect(tc).toBeDefined();
    expect(tc!.replies?.map((r) => r.id)).toEqual([2]);

    // ...and the reply is NOT also rendered as a top-level comment card.
    const topLevel = items.value.filter((i) => i.kind === 'comment');
    expect(topLevel).toHaveLength(0);
  });

  test('replies still thread under comment parents (no regression)', () => {
    const parent = comment(1);
    const reply = comment(3, 1);
    const items = useCommentSidebarItems({
      comments: ref<Comment[]>([parent, reply]),
      trackedChanges: ref<TrackedChangeEntry[]>([]),
    });

    const commentItems = items.value.filter((i) => i.kind === 'comment');
    expect(commentItems).toHaveLength(1);
    expect(commentItems[0].comment!.id).toBe(1);
    expect(commentItems[0].replies?.map((r) => r.id)).toEqual([3]);
  });

  test('a tracked change with no replies gets an empty replies array', () => {
    const items = useCommentSidebarItems({
      comments: ref<Comment[]>([]),
      trackedChanges: ref<TrackedChangeEntry[]>([change(200)]),
    });
    const tc = items.value.find((i) => i.kind === 'tracked-change');
    expect(tc!.replies).toEqual([]);
  });
});
