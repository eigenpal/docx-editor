import type { ResolvedRevisionMarkup } from './revision-markup.ts';
import type { EditorError, EditorSnapshot } from './editor.ts';
import type { HistoryDiagnostic } from './editor-scope.ts';

/**
 * What `editor.on(...)` can be subscribed to, and what each handler receives.
 *
 * These are PUSH notifications and are not interchangeable with reading `snapshot()`: a snapshot
 * read cannot observe an event that was never emitted, which is why adapter behaviour is asserted
 * against these rather than against the snapshot.
 */
export interface EditorEvents {
  /** Local viewer preferences changed through the API or review dialog. */
  revisionMarkupChange: (settings: ResolvedRevisionMarkup) => void;
  /** A document mutation committed, with the ids it touched. */
  change: (change: DocumentChange) => void;
  /** The selection or its derived formatting moved. */
  selectionChange: (snapshot: EditorSnapshot) => void;
  error: (error: EditorError) => void;
  historyDiagnostic: (diagnostic: HistoryDiagnostic) => void;
  /**
   * An explicit request landed on a review item, and its card or balloon should open.
   *
   * Fires each time Next Change or Previous Change lands (`source: 'navigate'`), and each time
   * `setActiveReviewItem(key, { announce: true })` succeeds (`source: 'host'`). It fires again
   * when the item was already active, so a card the reader closed can open again.
   *
   * It does not fire for a caret move, a click in the page, a dismissal (`key` of `null`), a
   * refused activation, or `setActiveReviewItem(key)` without `announce: true`. A remote edit in a
   * collaboration session never fires it: it is a local view event.
   *
   * @example
   * ```ts
   * editor.on('reviewItemReveal', ({ key, source }) => {
   *   openMyBalloon(key); // `source` is 'navigate' or 'host'
   * });
   * ```
   */
  reviewItemReveal: (event: ReviewItemRevealEvent) => void;
}

/**
 * The payload of the `reviewItemReveal` event.
 *
 * @public
 */
export interface ReviewItemRevealEvent {
  /**
   * The key of the review item to open. It matches `ReviewItemPlacement.key` in
   * `getReviewItems()`, including a paired replacement's key.
   */
  readonly key: string;
  /**
   * What asked for the item. `'navigate'` is Next Change or Previous Change, from the menu,
   * the toolbar, a shortcut, or `exec({ type: 'navigateReviewChange' })`. `'host'` is a call
   * to `setActiveReviewItem` (and so `useReview().setActive`) with `announce: true`.
   */
  readonly source: ReviewItemRevealSource;
}

/** What asked to reveal a review item. See {@link ReviewItemRevealEvent.source}. @public */
export type ReviewItemRevealSource = 'navigate' | 'host';

/**
 * The payload of the `change` event / `onChange`. It carries revision + identity
 * deltas, NOT serialized bytes: serializing a whole DOCX on every keystroke would
 * be prohibitive for large documents. Call `save()` to get bytes on demand.
 */
export interface DocumentChange {
  /** Replacement events must not start another external processing request. Absent for edits. */
  readonly source?: 'load' | 'refresh' | 'recovery';
  /** Package revision after this change — `getDocumentHandle()`'s number, monotonic. */
  readonly revision: number;
  /** Block ids created/deleted/edited by this change, when the engine reports them. */
  readonly created?: readonly string[];
  readonly deleted?: readonly string[];
  readonly dirty?: readonly string[];
}
