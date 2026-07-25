/**
 * Comment state: the array, the add-comment flow, and the mirrors stable callbacks read.
 *
 * PORTED from the legacy hook of the same name. The controlled/uncontrolled split is
 * legacy's and is the load-bearing part: when `commentsProp` is supplied the HOST owns
 * the array and every mutation goes out through `onCommentsChange` rather than touching
 * internal state; when it is not, internal state owns it and `onCommentsChange` still
 * fires for parity. The synchronous `*Ref` mirrors are legacy's too — stable callbacks
 * read `.current` so they never capture a stale array.
 *
 * The comments themselves come from the host today. `Editor.getComments` is a stub (the
 * package's comment part is read, but every `w:comment` is concatenated into one story
 * with its id, author and date dropped), so nothing here reads the engine for them — an
 * uncontrolled editor simply has no comments until that lands, which is the honest state
 * rather than an invented one.
 */
import { useCallback, useRef, useState } from 'react';
import type { Comment } from '../../../legacy-core-compat';

export interface FloatingCommentBtn {
  top: number;
  left: number;
}

export function useCommentManagement({
  commentsProp,
  onCommentDelete,
  onCommentsChange,
}: {
  commentsProp: Comment[] | undefined;
  onCommentDelete: ((comment: Comment) => void) | undefined;
  onCommentsChange: ((comments: Comment[]) => void) | undefined;
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

  // Synchronous mirrors used by stable callbacks. Assigned on every render so the latest
  // value is always visible from callbacks that read `.current`.
  const cleanOrphanedCommentsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const isAddingCommentRef = useRef(isAddingComment);
  isAddingCommentRef.current = isAddingComment;
  const onCommentDeleteRef = useRef(onCommentDelete);
  onCommentDeleteRef.current = onCommentDelete;
  const onCommentsChangeRef = useRef(onCommentsChange);
  onCommentsChangeRef.current = onCommentsChange;

  // Unified setter: resolves the new value, mutates internal state only when
  // UNCONTROLLED, and notifies the host either way.
  const setComments = useCallback(
    (update: Comment[] | ((prev: Comment[]) => Comment[])) => {
      const next = typeof update === 'function' ? update(commentsRef.current) : update;
      if (!isControlledComments) setInternalComments(next);
      commentsRef.current = next;
      onCommentsChangeRef.current?.(next);
    },
    [isControlledComments]
  );

  const deleteComment = useCallback(
    (comment: Comment) => {
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      onCommentDeleteRef.current?.(comment);
    },
    [setComments]
  );

  return {
    comments,
    setComments,
    deleteComment,
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
  };
}
