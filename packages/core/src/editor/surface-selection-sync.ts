// The two-way selection mirror and the IME lane (paginated-surface seam).
//
// The painted pages hold the browser's own selection, so there are two copies of one fact:
// the model's and the DOM's. This module owns the traffic between them in both directions —
// reading a gesture back into the model, writing the model back out, and deciding WHICH of
// the two is the newer whenever a repaint finds them disagreeing — plus the one lane where
// the DOM legitimately gets ahead of the model and cannot be stopped: an IME composition.
//
// SELECTION GESTURES ARE THE BROWSER'S. Drag, double-click for a word, triple-click for a
// paragraph, shift-click to extend, and selecting across a page boundary all come free
// because the painted spans are real text. Re-implementing them from records is how a
// surface ends up feeling worse than a textarea. Layout still owns geometry: what comes back
// from the DOM is which CHARACTERS were gestured over, never where they are.

import type { TreeApplyResult, TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/layout';
import {
  applySelectionToDom,
  domSelectionTouchesPages,
  selectionsEqual,
  semanticSelectionFromDom,
} from './dom-selection.ts';
import { paintedTextOf, paragraphReplacePlan } from './surface-input.ts';
import { collapsedAt } from './surface-selection-ops.ts';

/** What the composition root lends this lane. */
export interface SurfaceSelectionSyncDeps {
  readonly session: TreeDocxSession;
  /**
   * The document the surface was MOUNTED into, never the ambient global.
   *
   * The selection is a property of one document, and a surface mounted into an iframe or a
   * detached document would otherwise read and write the wrong one.
   */
  readonly document: Document;
  /** The painted pages: the only subtree a selection endpoint may map through. */
  readonly pagesLayer: HTMLElement;
  /** The CURRENT model selection — read per call, never captured. */
  selection(): SemanticSelection;
  /** Publish a selection: mirrors it into the DOM and reports the new state. */
  setSelection(next: SemanticSelection): void;
  /** Take a selection up WITHOUT mirroring or reporting — the caller is about to do both. */
  adoptSelection(next: SemanticSelection): void;
  commit(run: () => TreeApplyResult | boolean): void;
  render(): void;
  flushLayout(): boolean;
  /** The engine's painted caret, repainted with every mirror. */
  updateCaret(): void;
  /** The model text of one paragraph, for diffing what an IME wrote against it. */
  textOf(paragraphId: string): string;
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  /** The surface's clock, so every phase timer reads the same one. */
  now(): number;
  /** Book the cost of one mirror into the surface's perf slot. */
  recordSelectionMs(ms: number): void;
  /**
   * Whether a pointer gesture currently owns the selection.
   *
   * A drag publishes its own selection on every move, and the browser reports its own idea of
   * what is selected alongside it. Adopting one of those mid-gesture snaps the caret back to
   * whatever the DOM guessed, halfway through the drag.
   */
  isGesturing?(): boolean;
}

export interface SurfaceSelectionSync {
  /**
   * The pending-gesture adoption a render performs BEFORE it repaints, and the point at
   * which the model-moved flag is spent. Returns whether a gesture was taken up, which is
   * the one thing that makes an otherwise silent repaint worth reporting.
   */
  adoptBeforePaint(): boolean;
  /** Record that the MODEL now holds the newer selection: a commit, an undo, a navigation. */
  noteModelMoved(): void;
  /** Record that the two agree again, because the model's selection is being written out. */
  noteSelectionSettled(): void;
  /** Write the model selection into the browser's own. */
  mirrorToDom(): void;
  /** Whether an IME is composing, which suspends repainting. */
  isComposing(): boolean;
  readonly onSelectionChange: () => void;
  readonly onCompositionStart: () => void;
  readonly onCompositionEnd: () => void;
}

export function createSurfaceSelectionSync(deps: SurfaceSelectionSyncDeps): SurfaceSelectionSync {
  const { document, pagesLayer, session } = deps;

  let applyingSelection = false;
  /**
   * Whether the MODEL holds the newer of the two selections.
   *
   * Set by a deliberate move — a commit's post-edit caret, a navigation, undo — and cleared
   * both by the render that pushes it out and by a selection written straight to the DOM.
   * Every other render repaints a selection nobody moved, which is exactly when whatever the
   * user has gestured since is the newer of the two.
   */
  let modelMoved = false;
  /**
   * Whether an IME is composing.
   *
   * `beforeinput` for `insertCompositionText` is NOT cancelable — `preventDefault` is a
   * no-op — so composed text unavoidably lands in the painted DOM. The surface therefore
   * stops repainting for the duration (a repaint mid-composition destroys the IME's own
   * anchor and aborts or duplicates the session) and reconciles once when it ends.
   */
  let composing = false;
  /** The paragraph the composition started in, so the right one is reconciled. */
  let composingParagraph: string | null = null;

  /**
   * Take up a selection the user has made but the queued `selectionchange` has not delivered.
   *
   * Assigns rather than going through `setSelection`: the render this runs inside is about to
   * mirror the selection into the DOM and report the new state anyway.
   */
  function adoptPendingDomSelection(): boolean {
    const next = semanticSelectionFromDom(pagesLayer, document.getSelection());
    if (!next || selectionsEqual(next, deps.selection())) return false;
    deps.adoptSelection(next);
    return true;
  }

  /**
   * Whether writing the selection would take it from someone else.
   *
   * True when focus or the selection is already inside these pages, and also when NOTHING
   * holds a selection — writing one then takes it from nobody. What this refuses is the case
   * that matters: a caret living in another element, which a repaint here would otherwise
   * yank away with no focus change and no interaction.
   */
  function ownsSelection(): boolean {
    const active = document.activeElement;
    if (active && pagesLayer.contains(active)) return true;
    const domSelection = document.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return true;
    const anchor = domSelection.anchorNode;
    if (!anchor) return true;
    // A selection anchored in a subtree that has been removed from the document belongs to
    // nobody — a surface that was torn down, or a re-rendered host. Refusing to write over
    // it would leave this surface unable to show its own caret.
    if (!anchor.isConnected) return true;
    return pagesLayer.contains(anchor);
  }

  /** Mirror the native selection into the model. Ignores selections outside painted text. */
  const adoptDomSelection = (): void => {
    const domSelection = document.getSelection();
    const next = semanticSelectionFromDom(pagesLayer, domSelection);
    if (!next) {
      // NOT MAPPING IS NOT NOTHING HAPPENING.
      //
      // A gesture that landed inside these pages and resolved to no model position — header
      // furniture, which names paragraphs of another part — used to return here silently,
      // leaving the model on the range it held BEFORE. The browser then showed one selection
      // and the model held another, so the next toolbar command formatted text the user was
      // no longer looking at. Collapsing costs a range the model could not address anyway;
      // keeping one costs an edit in the wrong place.
      if (!domSelectionTouchesPages(pagesLayer, domSelection)) return;
      const collapsed = collapsedAt(deps.selection().head);
      if (selectionsEqual(collapsed, deps.selection())) return;
      deps.setSelection(collapsed);
      return;
    }
    if (selectionsEqual(next, deps.selection())) return;
    deps.setSelection(next);
  };

  /**
   * Commit whatever the browser wrote into a paragraph that the surface could not intercept.
   *
   * The diff itself lives in surface-input.ts; this applies it and lands the caret.
   */
  function reconcileParagraphFromDom(paragraphId: string): void {
    const painted = paintedTextOf(pagesLayer, paragraphId);
    if (painted === null) return;
    const plan = paragraphReplacePlan(paragraphId, deps.textOf(paragraphId), painted);
    if (!plan) return;
    deps.commit(() => session.applyTreeOps(plan.ops, deps.selectionMark()));
    deps.setSelection(collapsedAt({ paragraphId, offset: plan.caret }));
  }

  return {
    adoptBeforePaint() {
      // ADOPT BEFORE PAINTING.
      //
      // `selectionchange` is QUEUED, never dispatched from the gesture that caused it, so
      // between the browser making a selection and this surface hearing about it there is a
      // window on every browser. A repaint landing inside that window used to replace the
      // nodes the selection lives in and then write the MODEL's older selection into the new
      // ones — so a double-click was made correctly and did not survive the next scroll, and
      // the model never learned the word had been selected at all. Reading the DOM first
      // makes the repaint carry the gesture rather than erase it.
      //
      // A deliberate model move is the exception, and the reason this cannot simply refuse to
      // write: a commit installs its own post-edit caret, and the DOM selection left over
      // from before the edit addresses offsets that no longer mean the same thing.
      const adopted = modelMoved ? false : adoptPendingDomSelection();
      modelMoved = false;
      return adopted;
    },

    noteModelMoved() {
      modelMoved = true;
    },

    noteSelectionSettled() {
      // SEPARATE from `mirrorToDom`, which is where this obviously belongs and where it
      // would be wrong: the mirror refuses to write when this surface does not own the
      // selection, and in that case the model IS still the newer of the two. The flag is
      // spent by the decision to publish a selection, not by the write succeeding.
      modelMoved = false;
    },

    mirrorToDom() {
      // Ahead of the ownership guard: the caret is this engine's own, painted whether or not
      // the browser's selection lives here.
      deps.updateCaret();
      // Only when this surface owns the selection. A render runs on mount and on every commit
      // — including one from another editor sharing the store — and writing unconditionally
      // yanked the caret out of whatever the user was actually typing in.
      if (!ownsSelection()) return;
      applyingSelection = true;
      const began = deps.now();
      applySelectionToDom(pagesLayer, deps.selection(), document.getSelection());
      deps.recordSelectionMs(deps.now() - began);
      // Cleared on a LATER task, because `selectionchange` is queued rather than dispatched
      // synchronously. Clearing it here would defeat the guard in every real browser while
      // still appearing to work under a synchronous test DOM.
      queueMicrotask(() => {
        applyingSelection = false;
      });
    },

    isComposing: () => composing,

    onSelectionChange: (): void => {
      // Ignore the echo of our own write, and anything happening outside the pages. The flag
      // is cleared on a later task rather than synchronously: browsers QUEUE `selectionchange`
      // rather than firing it from `setBaseAndExtent`, so clearing it in a `finally` would
      // leave it false by the time the echo arrives — and every programmatic selection would
      // be read straight back, fighting the user mid-drag.
      if (applyingSelection) return;
      if (composing) return;
      if (deps.isGesturing?.()) return;
      adoptDomSelection();
    },

    onCompositionStart: (): void => {
      composing = true;
      composingParagraph = deps.selection().head.paragraphId;
      session.beginComposition();
    },

    onCompositionEnd: (): void => {
      composing = false;
      const paragraphId = composingParagraph ?? deps.selection().head.paragraphId;
      composingParagraph = null;
      // The composed text is in the DOM and nowhere else. Read it back, diff it against what
      // the model holds for that paragraph, and commit the difference — the only route by
      // which an IME edit can reach the tree, since it could not be intercepted.
      reconcileParagraphFromDom(paragraphId);
      session.endComposition();
      deps.flushLayout();
      deps.render();
    },
  };
}
