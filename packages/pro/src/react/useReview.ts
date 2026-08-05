/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review surface's data, as a hook.
//
// THIS is the API. `DocxEditor.Review` and its parts are one rendering of what this returns,
// shipped in the box; nothing is reachable through them that is not reachable here. A host that
// wants its own markup, its own card layout, or avatars from its own directory takes the hook
// and renders whatever it likes — the same relationship `useFontFamily` has with the packaged
// font picker.
//
// Two things the hook must give you and you should not recompute. The ITEMS come from the
// document tree, not from what is currently painted: a queue derived from the page empties by
// half when the reader switches to a resolved view. And each item's Y comes from layout records
// rather than from measuring painted DOM, which would put the sidebar a repaint behind the
// document and break outright during pagination.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  Editor,
  ReviewItemPlacement,
  ReviewItemQuery,
} from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from '@docx-editor.dev/react';

/**
 * One card's data plus where it belongs on screen.
 *
 * The engine's own placement, unchanged. It is already presentation-ready — author,
 * initials, date, text, thread — because deriving those from the canonical tree is engine
 * work, and an adapter deriving them would be document derivation in a host and would have
 * to be written once per framework.
 */
export type ReviewItemView = ReviewItemPlacement;

/**
 * What {@link useReview} returns: the review rail's data and the four things a card can do.
 *
 * @public
 */
export interface UseReviewReturn {
  /** Every pending decision in the document, in reading order. */
  readonly items: readonly ReviewItemView[];
  /** The item the caret is in, or null. */
  readonly activeKey: string | null;
  /** Card to document: selects the item's range and scrolls to it. */
  readonly setActive: (key: string | null) => void;
  /** Accept a revision. A no-op on an item whose `readOnly` is true. */
  readonly accept: (item: ReviewItemView) => void;
  /** Reject a revision. A no-op on an item whose `readOnly` is true. */
  readonly reject: (item: ReviewItemView) => void;
  /**
   * Discard the item: delete a comment thread, or reject a tracked change.
   *
   * One verb for both, so a card can carry one "remove this" control whatever it holds.
   * Reports whether it landed — a comment the engine refused to delete must not vanish from
   * the caller's own state while the document still holds it.
   */
  readonly remove: (item: ReviewItemView) => boolean;
  /**
   * Reply to a comment, or to a revision — which OOXML records as a comment on its range.
   *
   * The author is AMBIENT (`DocxEditorConfig.author`); pass one to override it for a single
   * reply. `CT_Comment` makes `@w:author` required, so the engine refuses a reply with
   * neither rather than writing an empty attribute — which is why this REPORTS whether the
   * reply landed. A box that cleared itself on a refusal would throw the text away and show
   * nothing, and the writer would not learn their reply never existed.
   */
  readonly reply: (item: ReviewItemView, text: string, author?: string) => boolean;
  /**
   * Where a comment on the current selection would sit, or null when nothing is selected.
   *
   * From the engine, not from the DOM — the same rule the card anchors follow.
   */
  readonly selectionAnchorY: number | null;
  /** Comment on the current selection. Reports whether it landed, like {@link reply}. */
  readonly comment: (text: string, author?: string) => boolean;
  /** Whether the pane shows cards. Engine state: the toolbar's comments button toggles it. */
  readonly paneOpen: boolean;
  /** Open or close the pane — the same toggle the toolbar button runs. */
  readonly setPaneOpen: (open: boolean) => void;
  /** True while the engine has no document, so a surface can render nothing rather than empty. */
  readonly ready: boolean;
}

/**
 * Read the review queue and act on it.
 *
 * Subscribes to the editor's own change stream, so the list re-derives when the document does
 * and not on every render.
 */
export function useReview(query?: ReviewItemQuery): UseReviewReturn {
  const editor = useDocxEditor();
  return useReviewOf(editor, query);
}

/** The same hook against an explicit editor, for hosts that hold their own. */
export function useReviewOf(editor: Editor | null, query?: ReviewItemQuery): UseReviewReturn {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!editor) return () => undefined;
      const offDocument = editor.on('change', onChange);
      const offSelection = editor.on('selectionChange', onChange);
      return () => {
        offDocument();
        offSelection();
      };
    },
    [editor]
  );

  const version = useSyncExternalStore(
    subscribe,
    () => (editor ? `${editor.getReviewRevision()}` : 'none'),
    () => 'none'
  );

  const items = useMemo<readonly ReviewItemView[]>(
    () => (editor ? editor.getReviewItems(query) : []),
    // `version` is the dependency: it changes exactly when the document or selection does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, version, query]
  );

  const activeKey = useMemo(() => items.find((entry) => entry.isActive)?.key ?? null, [items]);

  const setActive = useCallback(
    (key: string | null) => {
      editor?.setActiveReviewItem(key);
    },
    [editor]
  );

  const accept = useCallback(
    (item: ReviewItemView) => {
      if (item.kind !== 'revision' || item.readOnly) return;
      editor?.acceptReviewItem(item.key);
    },
    [editor]
  );

  const reject = useCallback(
    (item: ReviewItemView) => {
      if (item.kind !== 'revision' || item.readOnly) return;
      editor?.rejectReviewItem(item.key);
    },
    [editor]
  );

  const remove = useCallback(
    (item: ReviewItemView): boolean => {
      if (!editor) return false;
      // A custom node's card is informational and the engine refuses it; asking anyway would
      // put a refusal in the console for a button a surface should not have drawn.
      if (item.kind === 'custom') return false;
      if (item.kind === 'revision' && item.readOnly) return false;
      return editor.deleteReviewItem(item.key).ok;
    },
    [editor]
  );

  const reply = useCallback(
    (item: ReviewItemView, text: string, author?: string): boolean => {
      if (text.trim().length === 0 || !editor) return false;
      return editor.replyToReviewItem(item.key, text, author).ok;
    },
    [editor]
  );

  const selectionAnchorY = useMemo(
    () => (editor ? (editor.getSelectionPlacement()?.anchorY ?? null) : null),
    // Same dependency as the queue: the counter moves whenever the selection does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, version]
  );

  const comment = useCallback(
    (text: string, author?: string): boolean => {
      if (text.trim().length === 0 || !editor) return false;
      return editor.addComment(text, author).ok;
    },
    [editor]
  );

  const paneOpen = useMemo(
    () => (editor ? editor.isReviewPaneOpen() : true),
    // Same dependency as the queue: the pane toggle bumps the review revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, version]
  );

  const setPaneOpen = useCallback(
    (next: boolean) => {
      if (!editor || editor.isReviewPaneOpen() === next) return;
      editor.exec({ type: 'toggleReviewPane' });
    },
    [editor]
  );

  // MEMOIZED. A fresh object every render made every consumer's own memo useless — the rail
  // rebuilt its context, and with it every card, on renders where nothing about the review
  // had moved.
  return useMemo(
    () => ({
      items,
      activeKey,
      setActive,
      accept,
      reject,
      remove,
      reply,
      selectionAnchorY,
      comment,
      paneOpen,
      setPaneOpen,
      ready: editor !== null,
    }),
    [
      items,
      activeKey,
      setActive,
      accept,
      reject,
      remove,
      reply,
      selectionAnchorY,
      comment,
      paneOpen,
      setPaneOpen,
      editor,
    ]
  );
}

/**
 * Non-overlapping Y positions for cards you have measured.
 *
 * Separate from `useReview` because only the CALLER knows how tall its cards are — a host
 * rendering its own markup can be told where each anchor is, but not how much room its card
 * needs. Pass the measured heights back and get positions that do not collide; skip it
 * entirely and cards sit on their raw anchors, which is correct for a rail that does not stack.
 *
 * Takes anything with a key and an anchor, not only cards: a compose box competes for the
 * same column and has to be stacked WITH them or it lands on top of the card whose text was
 * just re-selected. Entries must arrive in document order — the run is a single sweep.
 *
 * UNITS. Anchors are in layout POINTS, because that is what the engine publishes; measured
 * heights are in CSS PIXELS, because that is what the DOM reports. Pass `scale` so the two
 * can be added. Without it a 330px card advanced the run by 330 POINTS — 440px — and two
 * comments on adjacent lines of one paragraph sat a third of a page apart.
 */
export function useStackedReviewPositions(
  items: readonly { readonly key: string; readonly anchorY: number | null }[],
  heights: ReadonlyMap<string, number>,
  options: { readonly gap?: number; readonly scale?: number; readonly defaultHeight?: number } = {}
): ReadonlyMap<string, number> {
  const gap = options.gap ?? 8;
  const scale = options.scale ?? 1;
  // What an entry with no measured height reserves, in CSS pixels. Zero keeps the historic
  // behavior — unmeasured cards advance the run by the gap alone; the packaged rail passes
  // an estimate so cards it has not measured yet (or has virtualized out of the DOM) still
  // hold a card's worth of room instead of painting over each other.
  const defaultHeight = options.defaultHeight ?? 0;
  return useMemo(() => {
    const positions = new Map<string, number>();
    let cursor = Number.NEGATIVE_INFINITY;
    for (const entry of items) {
      if (entry.anchorY === null) continue;
      const top = Math.max(entry.anchorY, cursor);
      positions.set(entry.key, top);
      // Pixels to points before they meet an anchor.
      cursor = top + ((heights.get(entry.key) ?? defaultHeight) + gap) / scale;
    }
    return positions;
  }, [items, heights, gap, scale, defaultHeight]);
}
