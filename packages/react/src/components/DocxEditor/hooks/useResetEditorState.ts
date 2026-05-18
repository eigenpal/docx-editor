import { useCallback } from 'react';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { HeadingInfo } from '@eigenpal/docx-editor-core/utils';
import { EMPTY_ANCHOR_POSITIONS } from '../commentFactories';

/**
 * Bundles the document-load reset surface — every state setter that
 * needs to clear when the user opens a new document. Twelve setters
 * fan out from one callback: comments, headings, sidebar visibility,
 * the new-comment workflow state, the floating button, H/F editing,
 * anchor positions, find-replace matches, and the orphan-cleanup timer.
 *
 * Lifted out of `DocxEditor.tsx` so the orchestrator doesn't carry the
 * ~20-line setter dump. The two `*LoadedRef`s come in from the parent
 * because they're co-owned with `useDocumentLoader` /
 * `useCommentLifecycle` — the parent threads them once.
 */
export function useResetEditorState({
  commentsLoadedRef,
  trackedChangesLoadedRef,
  setComments,
  setHeadingInfos,
  setShowCommentsSidebar,
  setIsAddingComment,
  setCommentSelectionRange,
  setAddCommentYPosition,
  setFloatingCommentBtn,
  setHfEditPosition,
  setHfEditIsFirstPage,
  setAnchorPositions,
  clearFindReplaceMatches,
  cleanOrphanedCommentsTimerRef,
}: {
  commentsLoadedRef: React.RefObject<boolean>;
  trackedChangesLoadedRef: React.RefObject<boolean>;
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  setHeadingInfos: React.Dispatch<React.SetStateAction<HeadingInfo[]>>;
  setShowCommentsSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAddingComment: React.Dispatch<React.SetStateAction<boolean>>;
  setCommentSelectionRange: React.Dispatch<
    React.SetStateAction<{ from: number; to: number } | null>
  >;
  setAddCommentYPosition: React.Dispatch<React.SetStateAction<number | null>>;
  setFloatingCommentBtn: React.Dispatch<React.SetStateAction<{ top: number; left: number } | null>>;
  setHfEditPosition: React.Dispatch<React.SetStateAction<'header' | 'footer' | null>>;
  setHfEditIsFirstPage: React.Dispatch<React.SetStateAction<boolean>>;
  setAnchorPositions: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  clearFindReplaceMatches: () => void;
  cleanOrphanedCommentsTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const resetForNewDocument = useCallback(() => {
    commentsLoadedRef.current = false;
    trackedChangesLoadedRef.current = false;
    setComments([]);
    setHeadingInfos([]);
    setShowCommentsSidebar(false);
    setIsAddingComment(false);
    setCommentSelectionRange(null);
    setAddCommentYPosition(null);
    setFloatingCommentBtn(null);
    setHfEditPosition(null);
    setHfEditIsFirstPage(false);
    setAnchorPositions(EMPTY_ANCHOR_POSITIONS);
    clearFindReplaceMatches();
    if (cleanOrphanedCommentsTimerRef.current) {
      clearTimeout(cleanOrphanedCommentsTimerRef.current);
      cleanOrphanedCommentsTimerRef.current = null;
    }
  }, [
    commentsLoadedRef,
    trackedChangesLoadedRef,
    setComments,
    setHeadingInfos,
    setShowCommentsSidebar,
    setIsAddingComment,
    setCommentSelectionRange,
    setAddCommentYPosition,
    setFloatingCommentBtn,
    setHfEditPosition,
    setHfEditIsFirstPage,
    setAnchorPositions,
    clearFindReplaceMatches,
    cleanOrphanedCommentsTimerRef,
  ]);

  return { resetForNewDocument };
}
