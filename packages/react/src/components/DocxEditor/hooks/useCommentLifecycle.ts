import { useEffect } from 'react';
import type { EditorState as PMEditorState } from 'prosemirror-state';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';

/**
 * Small effects that link the comment-management state to the document
 * lifecycle:
 *  - Thread top-level comments under any tracked-change that overlaps
 *    their range (parentId = revisionId). The overlap map is computed
 *    in the same doc walk as `extractTrackedChanges`, so this is a
 *    no-op extra cost per transaction.
 *  - Auto-open the comments sidebar on the first load of a document
 *    that already has tracked changes — guarded by
 *    `trackedChangesLoadedRef` so it only fires once per document.
 *
 * The `trackedChangesLoadedRef` is owned by the parent because
 * `resetForNewDocument` clears it on every fresh load (same pattern as
 * `commentsLoadedRef`).
 */
export function useCommentLifecycle({
  commentToRevision,
  setComments,
  pmState,
  isLoading,
  trackedChangesCount,
  setShowCommentsSidebar,
  trackedChangesLoadedRef,
}: {
  commentToRevision: Map<number, number>;
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  pmState: PMEditorState | null;
  isLoading: boolean;
  trackedChangesCount: number;
  setShowCommentsSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  trackedChangesLoadedRef: React.RefObject<boolean>;
}) {
  // Thread top-level comments under their overlapping tracked change.
  useEffect(() => {
    if (commentToRevision.size === 0) return;
    setComments((prev) => {
      let changed = false;
      const updated = prev.map((c) => {
        if (c.parentId != null) return c; // already threaded
        const rid = commentToRevision.get(c.id);
        if (rid != null) {
          changed = true;
          return { ...c, parentId: rid };
        }
        return c;
      });
      return changed ? updated : prev;
    });
  }, [commentToRevision, setComments]);

  // Auto-open the sidebar once if the loaded document already has
  // tracked changes. Resets on every fresh load via the parent-owned ref.
  useEffect(() => {
    if (trackedChangesLoadedRef.current) return;
    if (isLoading || !pmState) return;
    trackedChangesLoadedRef.current = true;
    if (trackedChangesCount > 0) setShowCommentsSidebar(true);
  }, [pmState, isLoading, trackedChangesCount, setShowCommentsSidebar, trackedChangesLoadedRef]);
}
