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

import { useCallback, useDeferredValue, useMemo, useRef, useSyncExternalStore } from 'react';
import type {
  DocumentChange,
  Editor,
  ReviewActivationOptions,
  ScrollPlacement,
  ReviewItemPlacement,
  ReviewItemQuery,
  ReviewItemRevealEvent,
  ReviewItemRevealSource,
} from '@docx-editor.dev/core/contracts/editor';
import type { ExecResult } from '@docx-editor.dev/core/contracts/types';
import { notificationYieldsToTask, useDocxEditor } from '@docx-editor.dev/react';
import { adoptReviewItems, type ReviewAdoptOptions } from '../review/review-item-author.ts';
import { stackReviewPositions } from '../review/rail-stack.ts';
import {
  reviewAuthorFilterKey,
  reviewRefusalStore,
  type ReviewWriteAction,
  type ReviewWriteRefusal,
} from '../review/review-refusal.ts';

export type { ReviewAdoptOptions };

/**
 * Collapse an input burst into one rail refresh.
 *
 * Review placement ranks and maps every card in the document. Running that synchronous
 * external-store update after every queued key-repeat event lets the rail consume more time
 * than the edit itself on review-heavy documents. Ordinary changes still notify immediately;
 * a browser-reported input backlog — or a notification-wave streak the shared policy says
 * must yield ({@link notificationYieldsToTask}) — moves the refresh to a task so queued
 * events share it and React's maximum-update-depth guard never sees an unbroken chain.
 */
let pendingFlushes: (() => void)[] = [];
let flushChannel: MessageChannel | null = null;
/**
 * Run `task` in a later task through a message, not a timer: the script's timers belong to
 * the opener when the editor renders into a pop-out window, and a hidden opener throttles
 * them to one run a second.
 */
function yieldTask(task: () => void): void {
  if (typeof MessageChannel !== 'function') {
    globalThis.setTimeout(task, 0);
    return;
  }
  if (!flushChannel) {
    flushChannel = new MessageChannel();
    flushChannel.port1.onmessage = () => {
      const tasks = pendingFlushes;
      pendingFlushes = [];
      for (const run of tasks) {
        try {
          run();
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    };
  }
  pendingFlushes.push(task);
  if (pendingFlushes.length === 1) flushChannel.port2.postMessage(null);
}

function deferredReviewNotifier(onStoreChange: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    if (!notificationYieldsToTask()) {
      onStoreChange();
      return;
    }
    scheduled = true;
    yieldTask(() => {
      scheduled = false;
      onStoreChange();
    });
  };
}

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
 * Where activating an item puts it in the viewport. The engine's own options, unchanged.
 *
 * Re-exported here so a host taking this hook can name what it passes without reaching past
 * the adapter into the engine's contract module.
 */
export type { ReviewActivationOptions, ScrollPlacement };
/** The payload of the editor's `reviewItemReveal` event. The engine's own type, unchanged. */
export type { ReviewItemRevealEvent, ReviewItemRevealSource };

/**
 * An edit in one paragraph, as typing is: one paragraph changed in place, none made or removed.
 * A decision reports no dirty paragraph, and a load or a structural edit reports more.
 */
function isTypingChange(change: DocumentChange): boolean {
  return change.dirty?.length === 1 && !change.created?.length && !change.deleted?.length;
}

/** What the review state depends on: the queue, the editing mode and the author filter. */
function reviewVersionOf(editor: Editor): string {
  return `${editor.getReviewRevision()}:${editor.getEditingMode()}:${reviewAuthorFilterKey(editor)}`;
}

/**
 * What {@link useReview} returns: the review rail's data and the things a card can do.
 *
 * @public
 */
export interface UseReviewReturn {
  /**
   * Every pending decision in the document, in reading order.
   *
   * Follows an edit in one paragraph, such as typing, at background priority. The document
   * paints first, and the cards follow in the next render, which a further keystroke can
   * interrupt. These update the cards at once:
   *
   * - the actions below
   * - a decision made elsewhere, such as from the toolbar or the editor API
   * - a new document
   * - a structural edit
   * - a selection change on its own
   *
   * A comment added another way, through `editor.addComment` or by a remote peer, changes one
   * paragraph. Its card follows at background priority too. The actions always act on the
   * document as it is.
   */
  readonly items: readonly ReviewItemView[];
  /** The CARET-ACTIVE item: the one the caret is in, or null. */
  readonly activeKey: string | null;
  /**
   * The key of the ACTIVATED item: the one {@link setActive}, Next Change, or Previous Change
   * made active, while the caret stays in it. `null` when only a caret move made an item
   * active. {@link activeKey} is the caret-active item instead: the one the caret is in,
   * however it got there. The key follows this hook's query, so a paired replacement reports
   * the pair's key under `pairReplacements: true`. The same value as the editor's
   * `getActivatedReviewItemKey(query)`, read on every selection change.
   */
  readonly activatedKey: string | null;
  /**
   * Card to document: puts the caret at the start of the item's range and scrolls to it. Nothing is selected; the open item draws its own highlight.
   *
   * Reports whether it landed, on the same terms as {@link accept}. False for an item whose
   * `activatable` is false — no resolvable range, or a revision kind this rail excluded — and
   * for a story that will not open. A queue walked with next/previous controls has no other
   * way to tell a step that did nothing from one that worked, and skipping to the next item
   * is only possible if you can find out.
   *
   * `options.reveal` picks where the item lands, or turns the engine's scroll off entirely
   * for a host whose own list already drives it. Default is centred when it has to travel,
   * still when it is already on screen.
   *
   * With `{ announce: true }`, a call that lands fires the editor's `reviewItemReveal` event
   * with `source: 'host'`, also when the item was already active. The packaged review UI then
   * opens the item's balloon, or opens a closed pane at its card when the pane's `opening`
   * setting is `'auto'`. Without it, the call fires no event. A `null` key closes the card.
   *
   * @example
   * ```tsx
   * const { setActive } = useReview();
   * useEditorEvent('reviewItemReveal', ({ key, source }) => openMyCard(key, source));
   * setActive(key); // fires nothing
   * setActive(key, { announce: true }); // fires 'reviewItemReveal'
   * setActive(key, { reveal: false }); // opens the item without scrolling
   * ```
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling | Accept or reject without scrolling}
   */
  readonly setActive: (key: string | null, options?: ReviewActivationOptions) => boolean;
  /**
   * Accept a revision. Reports whether it landed.
   *
   * False for an item whose `readOnly` is true, and equally for a resolution the engine
   * refuses on other grounds — a document open for viewing refuses every one. A caller
   * that assumed success drew a live button that did nothing.
   *
   * For headless or server use, see `Revision.accept()` in `@docx-editor.dev/editor-api`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling | Accept or reject without scrolling}
   */
  readonly accept: (item: ReviewItemView) => boolean;
  /**
   * Reject a revision. Reports whether it landed, on the same terms as {@link accept}.
   *
   * For headless or server use, see `Revision.reject()` in `@docx-editor.dev/editor-api`.
   */
  readonly reject: (item: ReviewItemView) => boolean;
  /**
   * Adopt tracked changes as the reviewer's own: they record the reviewer as their author
   * and stay pending for the next reviewer.
   *
   * Takes one item or a list, and ignores comment items. The default author is
   * `DocxEditorConfig.author`; `options.author` records someone else, and `options.date`
   * records a new date. All the changes update in one undo step. Reports whether it landed:
   * false when no revision was passed, when no author is known, or when the editor refuses
   * the write, as it does in viewing mode or under document protection.
   */
  readonly adopt: (
    items: ReviewItemView | readonly ReviewItemView[],
    options?: ReviewAdoptOptions
  ) => boolean;
  /** Resolve a comment thread. Repeating this on a resolved thread succeeds without a write. */
  readonly resolve: (item: ReviewItemView) => boolean;
  /** Reopen a resolved comment thread. Repeating this on an open thread is likewise idempotent. */
  readonly reopen: (item: ReviewItemView) => boolean;
  /**
   * Why Resolve and Reopen are unavailable, or null.
   *
   * This is the engine's refusal text, so custom card UI can disable the actions without
   * paraphrasing a viewing-mode policy that belongs to the editor.
   */
  readonly commentResolutionDisabledReason: string | null;
  /**
   * Discard the item: delete a comment thread, or reject a tracked change.
   *
   * One verb for both, so a card can carry one "remove this" control whatever it holds.
   * Reports whether it landed — a comment the engine refused to delete must not vanish from
   * the caller's own state while the document still holds it. A refused discard of a tracked
   * change is recorded in `lastRefusal` with `action: 'reject'`, as a refused reject is.
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
   *
   * For headless or server use, see `Comment.reply` in `@docx-editor.dev/editor-api`.
   */
  readonly reply: (item: ReviewItemView, text: string, author?: string) => boolean;
  /**
   * Where a comment on the current selection would sit, or null when nothing is selected.
   *
   * From the engine, not from the DOM — the same rule the card anchors follow.
   */
  readonly selectionAnchorY: number | null;
  /**
   * Comment on the current selection. Reports whether it landed, like {@link reply}.
   *
   * To comment on found text, select it first with `editor.findMatches` and
   * `editor.selectMatch`. For headless or server use, see `Range.insertComment` in
   * `@docx-editor.dev/editor-api`.
   *
   * @example
   * ```tsx
   * const [match] = editor.findMatches('Effective Date', { wholeWord: true });
   * if (match && editor.selectMatch(match).ok) comment('Define this term.');
   * ```
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text | Comment on found text}
   */
  readonly comment: (text: string, author?: string) => boolean;
  /**
   * Why the last accept, reject, resolve, reopen, remove, reply or comment did not land, or null.
   *
   * Shared by every `useReview()` over the same editor, so a custom card sees a refusal the
   * packaged rail recorded. Set by a refused write and cleared by the next one that lands, and
   * by a change to the document, the editing mode, editability, the collaboration status or
   * the author filter. A caret move keeps it. The packaged cards show it as a sentence; a
   * custom card reads `key` to place it, `useReviewRefusalMessage()` to word it, and `code`, the
   * public diagnostic code, to branch on the cause.
   *
   * @example
   * ```tsx
   * const { lastRefusal } = useReview();
   * const refusalMessage = useReviewRefusalMessage();
   * // The packaged rail announces it; this only shows it.
   * return lastRefusal?.key === item.key ? <p>{refusalMessage(lastRefusal)}</p> : null;
   * ```
   */
  readonly lastRefusal: ReviewWriteRefusal | null;
  /** Whether the pane shows cards. Engine state: the toolbar's comments button toggles it. */
  readonly paneOpen: boolean;
  /** Open or close the pane — the same toggle the toolbar button runs. */
  readonly setPaneOpen: (open: boolean) => void;
  /** False until the engine has a document, so a surface can render nothing rather than empty. */
  readonly ready: boolean;
}

/**
 * Read the review queue and act on it.
 *
 * Subscribes to the editor's own change stream, so the list re-derives when the document does
 * and not on every render.
 *
 * This is the browser review API: comment, reply, accept, reject, and open items from your own
 * UI. For headless, server, or agent pipelines, use `@docx-editor.dev/editor-api` instead.
 *
 * @see {@link https://www.docx-editor.dev/docs/2.x/recipes | Which API for which job}
 */
export function useReview(query?: ReviewItemQuery): UseReviewReturn {
  const editor = useDocxEditor();
  return useReviewOf(editor, query);
}

/** The same hook against an explicit editor, for hosts that hold their own. */
export function useReviewOf(editor: Editor | null, query?: ReviewItemQuery): UseReviewReturn {
  // Whether the last document change was typing in one paragraph; see `cardsVersion` below.
  const typing = useRef(false);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!editor) return () => undefined;
      let disposed = false;
      const notify = deferredReviewNotifier(() => {
        if (!disposed) onChange();
      });
      // A keystroke moves the caret in the same task as its change; a selection change on its
      // own (a click, an arrow key) is not typing, and the active card follows it at once.
      let changedThisTask = false;
      const offDocument = editor.on('change', (change) => {
        typing.current = isTypingChange(change);
        changedThisTask = true;
        queueMicrotask(() => (changedThisTask = false));
        notify();
      });
      const offSelection = editor.on('selectionChange', () => {
        if (!changedThisTask) typing.current = false;
        notify();
      });
      // `error` too: a load that fails to parse tears the surface down and emits ONLY an
      // error — no `change` fires for it. Without this, a surface built on the raw hook
      // kept the previous document's cards (and `ready: true`) over a document that never
      // opened, until some unrelated event happened to re-render it.
      const offError = editor.on('error', notify);
      return () => {
        disposed = true;
        offDocument();
        offSelection();
        offError();
      };
    },
    [editor]
  );

  const version = useSyncExternalStore(
    subscribe,
    // Editing mode is part of the public action state even when the queue itself is unchanged:
    // switching to viewing must disable Resolve/Reopen in a host-composed card immediately.
    () => (editor ? reviewVersionOf(editor) : 'none'),
    () => 'none'
  );

  // One store per EDITOR, so every hook over it, the packaged rail's included, sees the same
  // refusal. The store clears it once the state it was refused in changes.
  const subscribeRefusal = useCallback(
    (onChange: () => void) =>
      editor ? reviewRefusalStore(editor).subscribe(onChange) : () => undefined,
    [editor]
  );
  const lastRefusal = useSyncExternalStore(
    subscribeRefusal,
    () => (editor ? reviewRefusalStore(editor).get() : null),
    () => null
  );
  const settle = useCallback(
    (action: ReviewWriteAction, key: string | null, result: ExecResult): boolean => {
      // A card action's change can look like typing (a comment changes one paragraph), but
      // the card it adds or removes shows at once.
      typing.current = false;
      if (editor) reviewRefusalStore(editor).record(action, key, result);
      return result.ok;
    },
    [editor]
  );

  // While typing, the cards follow at background priority, as the Vue adapter's do on the next
  // task: a keystroke paints first, and the rail places its cards in a render after it that the
  // next keystroke can interrupt, so a burst of keys shares one placement. Any other change (a
  // decision, a new document) places them at once, so no card outlives its change and no earlier
  // document stays alive behind a deferred render. A test inside `act()` sees them either way.
  const deferredVersion = useDeferredValue(version);
  const cardsVersion = typing.current ? deferredVersion : version;
  const items = useMemo<readonly ReviewItemView[]>(
    () =>
      editor
        ? // A custom node with no `reviewCard` still produces an ITEM — that is what carries its
          // payload and text to the chip's own surfaces — but it asked for no card, so the rail
          // does not draw one. Filtered here rather than upstream so `getReviewItems` stays the
          // one answer to "what does this document hold".
          editor
            .getReviewItems(query)
            .filter((entry) => entry.item.kind !== 'custom' || entry.item.carded)
        : [],
    // `cardsVersion` is the dependency: it follows the document and selection at background
    // priority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, cardsVersion, query]
  );

  const activeKey = useMemo(() => items.find((entry) => entry.isActive)?.key ?? null, [items]);
  // Read on every selection change, not on the deferred review tick: a balloon decides in the
  // same frame whether the item was opened on purpose.
  const subscribeSelection = useCallback(
    (notify: () => void) => {
      if (!editor) return () => undefined;
      const offSelection = editor.on('selectionChange', notify);
      const offChange = editor.on('change', notify);
      return () => {
        offSelection();
        offChange();
      };
    },
    [editor]
  );
  const activatedKey = useSyncExternalStore(
    subscribeSelection,
    () => (editor ? editor.getActivatedReviewItemKey(query) : null),
    () => null
  );

  const setActive = useCallback(
    (key: string | null, options?: ReviewActivationOptions): boolean => {
      if (!editor) return false;
      return editor.setActiveReviewItem(key, options).ok;
    },
    [editor]
  );

  // BOTH REPORT, like `remove` and `reply` below. `readOnly` is not the only way a
  // resolution is refused — a document open for viewing refuses every one of them — and
  // swallowing the result left a host rendering live Accept and Reject buttons that did
  // nothing at all when clicked: no change, no error, nothing in the console.
  const accept = useCallback(
    (item: ReviewItemView): boolean => {
      if (!editor || item.kind !== 'revision' || item.readOnly) return false;
      return settle('accept', item.key, editor.acceptReviewItem(item.key));
    },
    [editor, settle]
  );

  const reject = useCallback(
    (item: ReviewItemView): boolean => {
      if (!editor || item.kind !== 'revision' || item.readOnly) return false;
      return settle('reject', item.key, editor.rejectReviewItem(item.key));
    },
    [editor, settle]
  );

  const adopt = useCallback(
    (items: ReviewItemView | readonly ReviewItemView[], options?: ReviewAdoptOptions): boolean =>
      adoptReviewItems(editor, items, options),
    [editor]
  );

  const resolve = useCallback(
    (item: ReviewItemView): boolean => {
      if (!editor || item.kind !== 'comment') return false;
      return settle('resolve', item.key, editor.setCommentResolved(item.key, true));
    },
    [editor, settle]
  );

  const reopen = useCallback(
    (item: ReviewItemView): boolean => {
      if (!editor || item.kind !== 'comment') return false;
      return settle('reopen', item.key, editor.setCommentResolved(item.key, false));
    },
    [editor, settle]
  );

  const commentResolutionDisabledReason =
    editor?.getEditingMode() === 'viewing' ? 'the document is open for viewing' : null;

  const remove = useCallback(
    (item: ReviewItemView): boolean => {
      if (!editor) return false;
      // A custom node's card is informational and the engine refuses it; asking anyway would
      // put a refusal in the console for a button a surface should not have drawn.
      if (item.kind === 'custom') return false;
      if (item.kind === 'revision' && item.readOnly) return false;
      // Discarding a tracked change rejects it, so its refusal reads as the reject's does.
      const action = item.kind === 'revision' ? 'reject' : 'remove';
      return settle(action, item.key, editor.deleteReviewItem(item.key));
    },
    [editor, settle]
  );

  const reply = useCallback(
    (item: ReviewItemView, text: string, author?: string): boolean => {
      if (text.trim().length === 0 || !editor) return false;
      return settle('reply', item.key, editor.replyToReviewItem(item.key, text, author));
    },
    [editor, settle]
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
      return settle('comment', null, editor.addComment(text, author));
    },
    [editor, settle]
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
      activatedKey,
      setActive,
      accept,
      reject,
      adopt,
      resolve,
      reopen,
      commentResolutionDisabledReason,
      remove,
      reply,
      selectionAnchorY,
      comment,
      lastRefusal,
      paneOpen,
      setPaneOpen,
      // Not merely "an editor exists": the instance is constructed before any bytes arrive,
      // and a `ready` that reported true then invited surfaces to draw an empty state over
      // the host's loading screen. A parse failure clears `isLoading` while still leaving
      // no document, so it must stay false then too. Re-derived with the queue: a
      // successful load emits `change`, a failed one emits `error`, and `subscribe` above
      // listens to both.
      ready:
        editor !== null && !editor.snapshot().isLoading && editor.snapshot().parseError === null,
    }),
    [
      items,
      activeKey,
      activatedKey,
      setActive,
      accept,
      reject,
      adopt,
      resolve,
      reopen,
      commentResolutionDisabledReason,
      remove,
      reply,
      selectionAnchorY,
      comment,
      lastRefusal,
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
 * just re-selected. Entries must arrive in document order.
 *
 * An entry with `isActive: true`, as a review placement has while its card is open, stays at
 * its own anchor. The entries before it move up to make room, so Next Change never leaves the
 * open card below the visible rail. Pass placements through as they are to keep this.
 *
 * UNITS. Anchors are in layout POINTS, because that is what the engine publishes; measured
 * heights are in CSS PIXELS, because that is what the DOM reports. Pass `scale` so the two
 * can be added. Without it a 330px card advanced the run by 330 POINTS — 440px — and two
 * comments on adjacent lines of one paragraph sat a third of a page apart.
 *
 * Returns each card's top in layout points. `useReviewRailMetrics` supplies `scale` and the
 * pixel offset of the first page: a card's CSS `top` is `metrics.top + position * metrics.scale`.
 *
 * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards | Custom cards in the review rail}
 */
export function useStackedReviewPositions(
  items: readonly {
    readonly key: string;
    readonly anchorY: number | null;
    /** Keep this entry at its own anchor; the entries before it move up. */
    readonly isActive?: boolean;
  }[],
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
  // The packaged rail's math, so an entry with no geometry yet keeps its place after the card
  // before it, and an open entry (`isActive: true`) stays at its anchor.
  return useMemo(
    () => stackReviewPositions(items, heights, { gap, scale, defaultHeight }),
    [items, heights, gap, scale, defaultHeight]
  );
}
