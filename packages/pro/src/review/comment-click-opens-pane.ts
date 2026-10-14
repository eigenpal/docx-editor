/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A click on commented text in the page opens a closed review pane on that comment.
//
// Shared by the React and Vue rails. A click, not a caret move: arrowing through a comment
// must not throw the pane open under the reader's typing.

import type { Editor } from '@docx-editor.dev/core/contracts/editor';

/**
 * Listen for clicks in the page of the editor that `rail` belongs to. After each click that
 * leaves the caret in an open comment, `open(key)` runs with that comment's key. The caller
 * decides whether a closed pane opens for it. Returns the cleanup.
 */
export function listenForCommentClicks(
  rail: HTMLElement,
  editor: Editor,
  open: (key: string) => void
): () => void {
  // The engine's own scroll-container class first: `offsetParent` needs layout.
  const scroller = (rail.closest('.docx-editor__scroll-container') ??
    rail.offsetParent) as HTMLElement | null;
  if (!scroller) return () => {};
  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (!editor.snapshot().selectionCollapsed) return;
    const target = event.target;
    if (!(target instanceof Element) || rail.contains(target)) return;
    const surface = target.closest('.docx-paginated-surface');
    if (!surface || !scroller.contains(surface)) return;
    const owner = surface.closest('.docx-editor__scroll-container');
    if (owner && owner !== scroller) return;
    // The surface placed the caret on press, so the active item is already the clicked one.
    const active = editor.getReviewItems({ placement: false }).find((item) => item.isActive);
    if (active?.kind === 'comment' && !active.resolved) open(active.key);
  };
  scroller.addEventListener('click', onClick);
  return () => scroller.removeEventListener('click', onClick);
}
