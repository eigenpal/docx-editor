import { useCallback, useEffect, useRef, useState } from 'react';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { PagedEditorRef } from '../PagedEditor';
import { PENDING_COMMENT_ID } from '../commentFactories';

interface FloatingCommentBtn {
  top: number;
  left: number;
}

/**
 * Owns the comment-management surface: controlled / uncontrolled routing
 * of the `comments` array, the new-comment workflow state (range,
 * Y-position anchor, `isAddingComment` flag), the floating add-comment
 * button position, the synchronous `commentsRef` mirror, and the
 * orphaned-comments debouncer.
 *
 * Controlled mode: when consumer passes `comments` as a prop, the editor
 * reads it directly and routes every mutation through `onCommentsChange`
 * instead of touching internal state.
 *
 * Uncontrolled mode: internal state owns the array; `onCommentsChange`
 * still fires for parity but is optional.
 */
export function useCommentManagement({
  commentsProp,
  onCommentDelete,
  onCommentsChange,
  pagedEditorRef,
}: {
  commentsProp: Comment[] | undefined;
  onCommentDelete: ((comment: Comment) => void) | undefined;
  onCommentsChange: ((comments: Comment[]) => void) | undefined;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
}) {
  const [internalComments, setInternalComments] = useState<Comment[]>([]);
  const isControlledComments = commentsProp !== undefined;
  const comments = isControlledComments ? commentsProp : internalComments;

  const [isAddingComment, setIsAddingComment] = useState(false);
  const [commentSelectionRange, setCommentSelectionRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [addCommentYPosition, setAddCommentYPosition] = useState<number | null>(null);
  const [floatingCommentBtn, setFloatingCommentBtn] = useState<FloatingCommentBtn | null>(null);

  // Synchronous mirrors used by stable callbacks. Assigned on every render so
  // the latest value is always visible from the callbacks that read `.current`.
  const cleanOrphanedCommentsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const isAddingCommentRef = useRef(isAddingComment);
  isAddingCommentRef.current = isAddingComment;
  const onCommentDeleteRef = useRef(onCommentDelete);
  onCommentDeleteRef.current = onCommentDelete;
  const onCommentsChangeRef = useRef(onCommentsChange);
  onCommentsChangeRef.current = onCommentsChange;

  // Unified setter that resolves the new value, mutates internal state when
  // uncontrolled, and always notifies via `onCommentsChange`. Reads through
  // `commentsRef.current` for the functional-update branch so the callback
  // stays stable across renders.
  const setComments = useCallback(
    (next: React.SetStateAction<Comment[]>) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: Comment[]) => Comment[])(commentsRef.current)
          : next;
      if (resolved === commentsRef.current) return;
      if (!isControlledComments) {
        commentsRef.current = resolved;
        setInternalComments(resolved);
      }
      onCommentsChangeRef.current?.(resolved);
    },
    [isControlledComments]
  );

  // Remove comments whose marks no longer exist in the document. Called
  // debounced from the document-change handler so the user doesn't see
  // comments vanish mid-edit.
  const cleanOrphanedComments = useCallback(() => {
    if (isAddingCommentRef.current) return;
    const view = pagedEditorRef.current?.getView();
    if (!view) return;
    const { doc, schema } = view.state;
    const commentMarkType = schema.marks.comment;
    if (!commentMarkType) return;

    const liveIds = new Set<number>();
    doc.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type === commentMarkType) {
          const id = mark.attrs.commentId as number;
          if (id !== PENDING_COMMENT_ID) liveIds.add(id);
        }
      }
    });

    const currentComments = commentsRef.current;
    const orphanedIds = new Set<number>();
    for (const c of currentComments) {
      if (c.parentId == null && !liveIds.has(c.id)) {
        orphanedIds.add(c.id);
      }
    }
    if (orphanedIds.size === 0) return;

    for (const c of currentComments) {
      if (orphanedIds.has(c.id)) onCommentDeleteRef.current?.(c);
    }
    setComments((prev) =>
      prev.filter((c) => !orphanedIds.has(c.id) && !orphanedIds.has(c.parentId!))
    );
  }, [pagedEditorRef, setComments]);

  // Unmount cleanup for the orphan-cleanup debouncer.
  useEffect(() => {
    return () => {
      if (cleanOrphanedCommentsTimerRef.current) {
        clearTimeout(cleanOrphanedCommentsTimerRef.current);
      }
    };
  }, []);

  return {
    comments,
    setComments,
    isAddingComment,
    setIsAddingComment,
    isAddingCommentRef,
    commentSelectionRange,
    setCommentSelectionRange,
    addCommentYPosition,
    setAddCommentYPosition,
    floatingCommentBtn,
    setFloatingCommentBtn,
    cleanOrphanedCommentsTimerRef,
    cleanOrphanedComments,
  };
}
