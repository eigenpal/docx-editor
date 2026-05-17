/**
 * Vue port of packages/react/src/hooks/useCommentSidebarItems.tsx.
 *
 * Returns a flat list of sidebar items derived from comments + tracked
 * changes. Items here carry just the data + anchor info; rendering is
 * left to the consumer (UnifiedSidebar.vue picks the right Vue
 * component per item kind). React's hook returns ReactSidebarItem with
 * a `render: (props) => ReactNode` closure baked in; Vue avoids that
 * because SFCs render via `<component :is="...">`-style dispatch.
 */
import { computed, type Ref } from 'vue';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { TrackedChangeEntry } from './useTrackedChanges';

export interface CommentSidebarItem {
  id: string;
  anchorPos: number;
  anchorKey?: string;
  priority?: number;
  isTemporary?: boolean;
  fixedY?: number;
  estimatedHeight?: number;
  kind: 'add-comment' | 'comment' | 'tracked-change';
  comment?: Comment;
  replies?: Comment[];
  change?: TrackedChangeEntry;
}

export interface UseCommentSidebarItemsOptions {
  comments: Ref<Comment[]>;
  trackedChanges: Ref<TrackedChangeEntry[]>;
  showResolved?: Ref<boolean>;
  isAddingComment?: Ref<boolean>;
  addCommentYPosition?: Ref<number | null>;
}

export function useCommentSidebarItems({
  comments,
  trackedChanges,
  showResolved,
  isAddingComment,
  addCommentYPosition,
}: UseCommentSidebarItemsOptions) {
  return computed<CommentSidebarItem[]>(() => {
    const items: CommentSidebarItem[] = [];

    if (isAddingComment?.value && addCommentYPosition?.value != null) {
      items.push({
        id: 'new-comment-input',
        anchorPos: 0,
        fixedY: addCommentYPosition.value,
        priority: -1000,
        isTemporary: true,
        estimatedHeight: 120,
        kind: 'add-comment',
      });
    }

    const repliesByParent = new Map<number, Comment[]>();
    for (const c of comments.value) {
      if (c.parentId != null) {
        const arr = repliesByParent.get(c.parentId);
        if (arr) arr.push(c);
        else repliesByParent.set(c.parentId, [c]);
      }
    }

    for (const comment of comments.value) {
      if (comment.parentId != null) continue;
      if (comment.done && !showResolved?.value) continue;
      items.push({
        id: `comment-${comment.id}`,
        anchorPos: 0,
        anchorKey: `comment-${comment.id}`,
        priority: 0,
        estimatedHeight: comment.done ? 28 : 80,
        kind: 'comment',
        comment,
        replies: repliesByParent.get(comment.id) ?? [],
      });
    }

    trackedChanges.value.forEach((change, idx) => {
      items.push({
        id: `tc-${change.revisionId}-${idx}`,
        anchorPos: change.from,
        anchorKey: `revision-${change.revisionId}`,
        priority: 1,
        estimatedHeight: 80,
        kind: 'tracked-change',
        change,
      });
    });

    return items;
  });
}
