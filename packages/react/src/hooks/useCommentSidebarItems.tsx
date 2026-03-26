import { useMemo } from 'react';
import type { Comment } from '@eigenpal/docx-core/types/content';
import type { ReactSidebarItem } from '../plugin-api/types';
import type { TrackedChangeEntry } from '../components/sidebar/cardUtils';
import { CommentCard } from '../components/sidebar/CommentCard';
import { TrackedChangeCard } from '../components/sidebar/TrackedChangeCard';
import { AddCommentCard } from '../components/sidebar/AddCommentCard';
import { ResolvedCommentMarker } from '../components/sidebar/ResolvedCommentMarker';

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
  onResolvedMarkerClick?: (commentId: number) => void;
}

export interface UseCommentSidebarItemsProps {
  comments: Comment[];
  trackedChanges: TrackedChangeEntry[];
  callbacks: CommentCallbacks;
  /** Show this specific resolved comment temporarily (for margin marker click) */
  expandedResolvedId?: number | null;
  isAddingComment?: boolean;
  addCommentYPosition?: number | null;
}

export function useCommentSidebarItems({
  comments,
  trackedChanges,
  callbacks,
  expandedResolvedId = null,
  isAddingComment = false,
  addCommentYPosition = null,
}: UseCommentSidebarItemsProps): ReactSidebarItem[] {
  // Active root comments (always visible in sidebar)
  const activeComments = useMemo(
    () => comments.filter((c) => c.parentId == null && !c.done),
    [comments]
  );

  // Resolved root comments (shown as compact markers or expanded card)
  const resolvedComments = useMemo(
    () => comments.filter((c) => c.parentId == null && c.done),
    [comments]
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

    // Active comment cards
    for (const comment of activeComments) {
      const replies = repliesByParent.get(comment.id) ?? [];
      items.push({
        id: `comment-${comment.id}`,
        anchorPos: 0,
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

    // Resolved comments — compact marker or expanded card
    for (const comment of resolvedComments) {
      const isExpanded = expandedResolvedId === comment.id;
      const replies = repliesByParent.get(comment.id) ?? [];
      items.push({
        id: `comment-${comment.id}`,
        anchorPos: 0,
        anchorKey: `comment-${comment.id}`,
        priority: 0,
        estimatedHeight: isExpanded ? 80 : 28,
        render: (props) =>
          isExpanded ? (
            <CommentCard
              {...props}
              comment={comment}
              replies={replies}
              onReply={callbacks.onCommentReply}
              onResolve={callbacks.onCommentResolve}
              onUnresolve={callbacks.onCommentUnresolve}
              onDelete={callbacks.onCommentDelete}
            />
          ) : (
            <ResolvedCommentMarker
              {...props}
              comment={comment}
              onClick={() => callbacks.onResolvedMarkerClick?.(comment.id)}
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
    activeComments,
    resolvedComments,
    expandedResolvedId,
    trackedChanges,
    repliesByParent,
    callbacks,
    isAddingComment,
    addCommentYPosition,
  ]);
}
