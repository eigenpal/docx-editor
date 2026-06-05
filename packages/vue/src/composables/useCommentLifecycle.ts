/**
 * Comment lifecycle composable — owns the surface state and side-effects
 * around the "Add comment" flow + the floating action button + the
 * sidebar's selection-driven focus tracking.
 *
 * Specifically owns:
 *   • The pending-comment range (selection captured at the moment the
 *     user clicked the FAB).
 *   • `addCommentYPosition` (anchor Y for the AddCommentCard in the
 *     sidebar rail).
 *   • `floatingCommentBtn` (the FAB position) and its
 *     `recomputeFloatingCommentBtn()` lifecycle: a `watch` on
 *     `[stateTick, isAddingComment, zoom]`, a `ResizeObserver` on
 *     `pagesRef`, and a `window.resize` listener — all installed via
 *     `onMounted`/`onBeforeUnmount`.
 *   • `sidebarAutoOpenedRef` plus `extractCommentsAndChanges()` — the
 *     bridge that snapshots comments + tracked changes off the document
 *     into the shallowRefs the sidebar reads.
 *   • `handleAddComment` / `handleCancelAddComment` — the submit/cancel
 *     transitions that swap the pending `commentId: -1` mark with the
 *     real id, or strip it.
 *   • `handleStartAddComment` — the FAB click handler that captures the
 *     selection range, stamps the pending mark, and opens the sidebar
 *     in "adding" mode.
 *   • `recomputeActiveSidebarItem` (and its `watch(stateTick)`) — keeps
 *     the sidebar card auto-expanded for whichever comment / tracked
 *     change the cursor is currently inside.
 *
 * The composable receives the cross-cluster refs (`comments`,
 * `trackedChanges`, `showSidebar`, `isAddingComment`, `resolvedCommentIds`,
 * `activeSidebarItem`) as inputs from the parent so other composables
 * that read them (margin markers, sidebar) keep a single source of truth.
 */

import { ref, onMounted, onBeforeUnmount, watch, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { extractTrackedChanges } from '@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges';
import { findElementAtPosition } from '../utils/domQueries';
import { createComment as createCommentCore } from '@eigenpal/docx-editor-core/prosemirror/commentOps';
import {
  seedCommentAllocator,
  PENDING_COMMENT_ID,
  type CommentIdAllocator,
} from '@eigenpal/docx-editor-core/prosemirror/commentIdAllocator';
import type { TrackedChangeEntry } from '../components/sidebar/sidebarUtils';

export interface UseCommentLifecycleOptions {
  editorView: Ref<EditorView | null>;
  getDocument: () => Document | null;
  comments: Ref<Comment[]>;
  trackedChanges: Ref<TrackedChangeEntry[]>;
  resolvedCommentIds: Ref<Set<number>>;
  /** Shared per-instance ID allocator (see useCommentManagement). */
  commentIdAllocator: CommentIdAllocator;
  activeSidebarItem: Ref<string | null>;
  showSidebar: Ref<boolean>;
  isAddingComment: Ref<boolean>;
  readOnly: Ref<boolean>;
  zoom: Ref<number>;
  stateTick: Ref<number>;
  pagesRef: Ref<HTMLElement | null>;
  pagesViewportRef: Ref<HTMLElement | null>;
  emit: (event: string, ...args: unknown[]) => void;
}

export function useCommentLifecycle(opts: UseCommentLifecycleOptions) {
  const floatingCommentBtn = ref<{ top: number; left: number } | null>(null);
  const pendingCommentRange = ref<{ from: number; to: number } | null>(null);
  const addCommentYPosition = ref<number | null>(null);
  const sidebarAutoOpenedRef = ref(false);

  function extractCommentsAndChanges() {
    const doc = opts.getDocument();
    const view = opts.editorView.value;
    if (!doc || !view) return;

    // Comments live on `package.document.comments` (DocumentBody), not on
    // the package root — wrong path here was the reason the Vue sidebar
    // always showed "No comments or changes". Cloning is required so the
    // shallowRef reactivity fires.
    opts.comments.value = [...(doc.package?.document?.comments ?? [])];

    // Same merge/replacement logic React uses, lifted to core so both
    // adapters share one implementation.
    opts.trackedChanges.value = extractTrackedChanges(view.state).entries;

    // Auto-open the sidebar on first load if the document carries comments
    // or tracked changes.
    if (
      !sidebarAutoOpenedRef.value &&
      (opts.comments.value.length > 0 || opts.trackedChanges.value.length > 0)
    ) {
      opts.showSidebar.value = true;
      sidebarAutoOpenedRef.value = true;
    }
  }

  function recomputeFloatingCommentBtn() {
    void opts.stateTick.value; // dependency — re-runs on every PM transaction
    const view = opts.editorView.value;
    if (!view || opts.isAddingComment.value || opts.readOnly.value) {
      floatingCommentBtn.value = null;
      return;
    }
    const { from, to } = view.state.selection;
    if (from === to) {
      floatingCommentBtn.value = null;
      return;
    }
    // The FAB is rendered as a child of `pages-viewport`, which is
    // UNSCALED (only the inner `__pages` carries the
    // translateX/scale transform). All position math is in pages-
    // viewport coords — `getBoundingClientRect` already returns
    // post-transform CSS px, so no /zoom adjustments are needed; we
    // just convert from viewport-window space into viewport-relative
    // space (subtract the viewport's own bounding-rect origin) and add
    // the viewport's scrollTop for the absolute child's `top:`.
    const pagesContainer = opts.pagesRef.value;
    const viewport = opts.pagesViewportRef.value;
    if (!pagesContainer || !viewport) {
      floatingCommentBtn.value = null;
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const spanEl = findElementAtPosition(pagesContainer, from);
    if (!spanEl) {
      floatingCommentBtn.value = null;
      return;
    }
    const top = spanEl.getBoundingClientRect().top - viewportRect.top + viewport.scrollTop;
    const pageEl = pagesContainer.querySelector<HTMLElement>('.layout-page');
    if (!pageEl) {
      floatingCommentBtn.value = null;
      return;
    }
    const pageRect = pageEl.getBoundingClientRect();
    const left = pageRect.right - viewportRect.left + 8;
    floatingCommentBtn.value = { top, left };
  }

  // Cursor-driven sidebar expand. When the cursor lands on a span
  // covered by a comment / insertion / deletion mark, auto-expand
  // the matching sidebar card (and open the sidebar if it isn't
  // already).
  function recomputeActiveSidebarItem() {
    void opts.stateTick.value;
    const view = opts.editorView.value;
    if (!view) return;
    const $from = view.state.selection.$from;
    const marks = [
      ...(view.state.storedMarks ?? []),
      ...($from.nodeAfter?.marks ?? []),
      ...($from.nodeBefore?.marks ?? []),
      ...$from.marks(),
    ];
    let nextItem: string | null = null;
    for (const mark of marks) {
      if (mark.type.name === 'comment' && mark.attrs.commentId != null) {
        const cid = mark.attrs.commentId as number;
        // Skip resolved threads + the pending -1 placeholder so the
        // sidebar doesn't refocus while the user is typing in
        // AddCommentCard.
        if (cid === PENDING_COMMENT_ID) continue;
        if (opts.resolvedCommentIds.value.has(cid)) continue;
        nextItem = `comment-${cid}`;
        break;
      }
      if (
        (mark.type.name === 'insertion' || mark.type.name === 'deletion') &&
        mark.attrs.revisionId != null
      ) {
        const revId = String(mark.attrs.revisionId);
        const match = opts.trackedChanges.value.findIndex(
          (c) => String(c.revisionId) === revId || String(c.insertionRevisionId ?? '') === revId
        );
        if (match >= 0) {
          nextItem = `tc-${opts.trackedChanges.value[match].revisionId}-${match}`;
          break;
        }
      }
    }
    if (nextItem) {
      opts.showSidebar.value = true;
    }
    opts.activeSidebarItem.value = nextItem;
  }

  function handleStartAddComment() {
    const view = opts.editorView.value;
    if (!view) return;
    const { from, to } = view.state.selection;
    if (from === to) return;
    pendingCommentRange.value = { from, to };
    // Capture the floating button's Y so the AddCommentCard renders
    // anchored to the selection, not at the top of the rail.
    addCommentYPosition.value = floatingCommentBtn.value?.top ?? null;
    // Stamp a pending comment mark (commentId: -1) over the selection
    // so the layout-painter writes [data-comment-id] right away — the
    // user sees the yellow highlight immediately instead of waiting
    // for submit.
    const commentMark = view.state.schema.marks.comment;
    if (commentMark) {
      const tr = view.state.tr.addMark(
        from,
        to,
        commentMark.create({ commentId: PENDING_COMMENT_ID })
      );
      view.dispatch(tr);
    }
    opts.showSidebar.value = true;
    opts.isAddingComment.value = true;
    floatingCommentBtn.value = null;
  }

  function handleAddComment(text: string) {
    const doc = opts.getDocument();
    const view = opts.editorView.value;
    if (!doc?.package) return;
    if (!doc.package.document.comments) doc.package.document.comments = [];

    seedCommentAllocator(opts.commentIdAllocator, doc.package.document.comments, view);
    const newComment = createCommentCore(opts.commentIdAllocator, text, 'User');
    doc.package.document.comments.push(newComment);
    opts.comments.value = [...doc.package.document.comments];

    // Swap the pending `commentId: -1` mark for the real id over the
    // captured range so the layout-painter writes [data-comment-id="N"].
    const range = pendingCommentRange.value;
    if (view && range && range.from !== range.to) {
      const commentMark = view.state.schema.marks.comment;
      if (commentMark) {
        let tr = view.state.tr.removeMark(range.from, range.to, commentMark);
        tr = tr.addMark(range.from, range.to, commentMark.create({ commentId: newComment.id }));
        view.dispatch(tr);
      }
    }
    pendingCommentRange.value = null;
    addCommentYPosition.value = null;
    opts.isAddingComment.value = false;
    opts.emit('change', doc);
  }

  function handleCancelAddComment() {
    // Strip the pending -1 mark so the yellow highlight clears when
    // the user cancels.
    const view = opts.editorView.value;
    const range = pendingCommentRange.value;
    if (view && range && range.from !== range.to) {
      const commentMark = view.state.schema.marks.comment;
      if (commentMark) {
        view.dispatch(view.state.tr.removeMark(range.from, range.to, commentMark));
      }
    }
    pendingCommentRange.value = null;
    addCommentYPosition.value = null;
    opts.isAddingComment.value = false;
  }

  function handleMarkerClick(_commentId: number) {
    // Mirrors React: marker click opens the sidebar; the card itself
    // re-anchors to the click target via the comment-id selector.
    opts.showSidebar.value = true;
  }

  watch([opts.stateTick, opts.isAddingComment, opts.zoom], () => recomputeFloatingCommentBtn());
  watch(opts.stateTick, () => recomputeActiveSidebarItem());
  // Re-extract comments + tracked changes on every PM transaction so the
  // sidebar stays in sync as the user types. Without this, the sidebar
  // only refreshes on toggle/accept/reject — typing after the sidebar
  // is open would leave the card list stale (React already does this via
  // useTrackedChanges memoized on state).
  watch(opts.stateTick, () => extractCommentsAndChanges());

  let floatingResizeObserver: ResizeObserver | null = null;
  onMounted(() => {
    floatingResizeObserver = new ResizeObserver(() => recomputeFloatingCommentBtn());
    if (opts.pagesRef.value) floatingResizeObserver.observe(opts.pagesRef.value);
    window.addEventListener('resize', recomputeFloatingCommentBtn);
  });
  onBeforeUnmount(() => {
    floatingResizeObserver?.disconnect();
    window.removeEventListener('resize', recomputeFloatingCommentBtn);
  });

  return {
    floatingCommentBtn,
    pendingCommentRange,
    addCommentYPosition,
    sidebarAutoOpenedRef,
    extractCommentsAndChanges,
    handleAddComment,
    handleCancelAddComment,
    handleStartAddComment,
    handleMarkerClick,
    recomputeFloatingCommentBtn,
    recomputeActiveSidebarItem,
  };
}
