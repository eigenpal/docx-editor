/**
 * Two pieces of comment bookkeeping that run off document load.
 *
 * PORTED from the legacy hook of the same name, both effects intact:
 *
 *  1. Thread top-level comments under the tracked change they overlap, so a comment left
 *     on a revision shows as a reply to it rather than as a separate card. Only comments
 *     that are not already threaded (`parentId == null`) are touched, and the array
 *     identity is preserved when nothing changed — legacy's guard, kept, because
 *     returning a fresh array every time would rerender the whole sidebar on every load.
 *  2. Auto-open the sidebar ONCE if the loaded document already has tracked changes. The
 *     latch is a parent-owned ref so a fresh load resets it, which is why it is a
 *     parameter rather than local state.
 *
 * Legacy gated the second effect on the editing engine's state being present
 * (`pmState`); the equivalent readiness signal here is that layout has published, which
 * the caller passes as `isLoading`.
 */
import { useEffect } from 'react';
import type { Comment } from '../../../legacy-core-compat';

export function useCommentLifecycle({
  commentToRevision,
  setComments,
  isLoading,
  trackedChangesCount,
  setShowCommentsSidebar,
  trackedChangesLoadedRef,
}: {
  commentToRevision: Map<number, number>;
  setComments: (update: Comment[] | ((prev: Comment[]) => Comment[])) => void;
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

  // Auto-open the sidebar once if the loaded document already has tracked changes.
  // Resets on every fresh load via the parent-owned ref.
  useEffect(() => {
    if (trackedChangesLoadedRef.current) return;
    if (isLoading) return;
    trackedChangesLoadedRef.current = true;
    if (trackedChangesCount > 0) setShowCommentsSidebar(true);
  }, [isLoading, trackedChangesCount, setShowCommentsSidebar, trackedChangesLoadedRef]);
}
