import { useMemo } from 'react';
import type { Comment } from '@eigenpal/docx-core/types/content';
import type { ReactSidebarItem } from '../plugin-api/types';
import type { TrackedChangeEntry } from '../components/sidebar/cardUtils';
import { CommentCard } from '../components/sidebar/CommentCard';
import { TrackedChangeCard } from '../components/sidebar/TrackedChangeCard';
import { AddCommentCard } from '../components/sidebar/AddCommentCard';

export interface CommentCallbacks {
  onCommentReply?: (commentId: number, text: string) => void;
  onCommentResolve?: (commentId: number) => void;
  onCommentUnresolve?: (commentId: number) => void;
  onCommentDelete?: (commentId: number) => void;
  onAddComment?: (text: string) => void;
  onCancelAddComment?: () => void;
  onAcceptChange?: (from: number, to: number) => void;
  onRejectChange?: (from: number, to: number) => void;
  onTrackedChangeReply?: (revisionId: number, text: string) => void;
}

export interface UseCommentSidebarItemsProps {
  comments: Comment[];
  trackedChanges: TrackedChangeEntry[];
  callbacks: CommentCallbacks;
  /** When sidebar is open, include resolved comments */
  showResolved?: boolean;
  isAddingComment?: boolean;
  addCommentYPosition?: number | null;
}

export function useCommentSidebarItems({
  comments,
  trackedChanges,
  callbacks,
  showResolved = false,
  isAddingComment = false,
  addCommentYPosition = null,
}: UseCommentSidebarItemsProps): ReactSidebarItem[] {
  // Active comments always, resolved only when showResolved
  const visibleComments = useMemo(
    () =>
      comments.filter((c) => {
        if (c.parentId != null) return false;
        if (c.done && !showResolved) return false;
        return true;
      }),
    [comments, showResolved]
  );

  // Pre-group replies by parentId
  const repliesByParent = useMemo(() => {
    const map = new Map<number, Comment[]>();
    for (const c of comments) {
      if (c.parentId != null) {
        const arr = map.get(c.parentId);
        if (arr) arr.push(c);
        else map.set(c.parentId, [c]);
      }
    }
    return map;
  }, [comments]);

  return useMemo(() => {
    const items: ReactSidebarItem[] = [];

    // "Add comment" input (temporary item with pre-computed Y)
    if (isAddingComment && addCommentYPosition != null) {
      items.push({
        id: 'new-comment-input',
        anchorPos: 0,
        fixedY: addCommentYPosition,
        priority: -1000, // always first at its Y
        isTemporary: true,
        estimatedHeight: 120,
        render: (props) => (
          <AddCommentCard
            {...props}
            onSubmit={callbacks.onAddComment}
            onCancel={callbacks.onCancelAddComment}
          />
        ),
      });
    }

    // Comment cards
    for (const comment of visibleComments) {
      const replies = repliesByParent.get(comment.id) ?? [];
      items.push({
        id: `comment-${comment.id}`,
        anchorPos: 0, // resolved via anchorKey
        anchorKey: `comment-${comment.id}`,
        priority: 0,
        estimatedHeight: 80,
        render: (props) => (
          <CommentCard
            {...props}
            comment={comment}
            replies={replies}
            onReply={callbacks.onCommentReply}
            onResolve={callbacks.onCommentResolve}
            onUnresolve={callbacks.onCommentUnresolve}
            onDelete={callbacks.onCommentDelete}
          />
        ),
      });
    }

    // Tracked change cards
    trackedChanges.forEach((change, idx) => {
      const replies = repliesByParent.get(change.revisionId) ?? [];
      items.push({
        id: `tc-${change.revisionId}-${idx}`,
        anchorPos: change.from,
        anchorKey: `revision-${change.revisionId}`,
        priority: 1,
        estimatedHeight: 80,
        render: (props) => (
          <TrackedChangeCard
            {...props}
            change={change}
            replies={replies}
            onAccept={callbacks.onAcceptChange}
            onReject={callbacks.onRejectChange}
            onReply={callbacks.onTrackedChangeReply}
          />
        ),
      });
    });

    return items;
  }, [
    visibleComments,
    trackedChanges,
    repliesByParent,
    callbacks,
    isAddingComment,
    addCommentYPosition,
  ]);
}
