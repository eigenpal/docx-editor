// Deletions an input method asks for, rather than a key (paginated-surface seam).
//
// A hardware key, and a keyboard that sends real key events, deletes through the keymap. A
// keyboard that deletes through the platform's text service instead (on Android,
// `InputConnection.deleteSurroundingText`) reaches the page only as `beforeinput`, with the
// characters it means named by `getTargetRanges()`. Two things make that range more than a
// formality:
//
//   - A keyboard that falls behind batches its presses: one event names two or more
//     characters. Deleting one per event loses the rest, and the next presses then land in
//     the middle of the word.
//   - The keyboard keeps its own copy of the text and of the caret. When that copy drifts, the
//     range names characters somewhere else entirely, so its POSITION cannot be trusted where
//     it disagrees with the caret.
//
// So the range is believed for HOW MUCH to delete only where it is anchored at the caret, and
// the deletion runs as that many ordinary Backspace (or Delete) steps. Every rule those keys
// follow — fields, content controls, list numbers, paragraph joins, table cells, tracked
// changes — applies unchanged, and a step the document refuses ends the run rather than being
// retried. A range that is not anchored at the caret deletes one step at the caret, which is
// what the key the user pressed means. The single exception is a range the browser itself
// SELECTS: a keyboard can select a word and then delete it, and that selection deletes as a
// selection.

import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  positionFromDomPoint,
  selectionsEqual,
  semanticSelectionFromDom,
} from './dom-selection.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { SurfaceSelectionSync } from './surface-selection-sync.ts';

/**
 * The most steps one input event deletes. A keyboard names a few characters, or a word; the
 * bound only keeps a malformed range from turning one event into a long run of commits.
 */
export const MAX_IME_DELETION_STEPS = 256;

/** How one deletion event is carried out. */
export type ImeDeletionPlan =
  /** `count` Backspace (or Delete) steps at the caret. */
  | { readonly kind: 'steps'; readonly count: number }
  /** Select this range, which the browser already shows selected, and delete it. */
  | { readonly kind: 'selection'; readonly selection: SemanticSelection };

const ONE_STEP: ImeDeletionPlan = { kind: 'steps', count: 1 };

function samePosition(a: SemanticPosition, b: SemanticPosition): boolean {
  return a.paragraphId === b.paragraphId && a.offset === b.offset;
}

/**
 * The paragraphs a range crosses, in DOM order, or null when they cannot be listed.
 *
 * Asked of the painted fragments under the range's common ancestor, so the scan is bounded by
 * the range itself rather than by the document.
 */
function paragraphsCrossed(range: StaticRange): readonly string[] | null {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return null;
  let live: Range;
  try {
    live = doc.createRange();
    live.setStart(range.startContainer, range.startOffset);
    live.setEnd(range.endContainer, range.endOffset);
  } catch {
    return null;
  }
  const common = live.commonAncestorContainer;
  const scope = common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement;
  if (!scope) return null;
  const ids: string[] = [];
  // Fragments and lines as well as text, so an empty paragraph in between is counted too.
  for (const element of scope.querySelectorAll<HTMLElement>('[data-paragraph-id]')) {
    if (!live.intersectsNode(element)) continue;
    const id = element.dataset.paragraphId!;
    if (ids.at(-1) !== id) ids.push(id);
    // A paragraph listed twice was painted twice (a repeated header row): not a plain run.
    if (ids.indexOf(id) !== ids.length - 1) return null;
  }
  return ids;
}

/**
 * How many single steps the model range `[start, end)` holds: one per UTF-16 unit, the unit
 * one Backspace removes, and one per paragraph boundary, which one Backspace joins.
 */
function stepsBetween(
  start: SemanticPosition,
  end: SemanticPosition,
  range: StaticRange,
  textOf: (paragraphId: string) => string
): number | null {
  if (start.paragraphId === end.paragraphId) return end.offset - start.offset;
  const crossed = paragraphsCrossed(range);
  // The range must run from the start's paragraph to the end's, through whole paragraphs.
  // Painted text between them that does not say so is not a range this can count.
  if (!crossed || crossed.length < 2) return null;
  if (crossed[0] !== start.paragraphId || crossed.at(-1) !== end.paragraphId) return null;
  let steps = textOf(start.paragraphId).length - start.offset + 1;
  for (const middle of crossed.slice(1, -1)) steps += textOf(middle).length + 1;
  return steps + end.offset;
}

/** The range ordered start-first, whichever way the user extended it. */
function ordered(selection: SemanticSelection, start: SemanticPosition): SemanticSelection {
  return samePosition(selection.anchor, start)
    ? selection
    : { anchor: selection.head, head: selection.anchor };
}

/**
 * Decide how one `deleteContentBackward` / `deleteContentForward` event deletes.
 *
 * `browserSelectionTrusted` is false while an input method may still be correcting the
 * browser's selection after its own edit; a selection it parked then is not the user's.
 */
export function imeDeletionPlan(
  event: InputEvent,
  root: Element,
  selection: SemanticSelection,
  textOf: (paragraphId: string) => string,
  direction: 'backward' | 'forward',
  browserSelectionTrusted: boolean
): ImeDeletionPlan {
  // A selection deletes as itself; the range only restates it.
  if (!samePosition(selection.anchor, selection.head)) return ONE_STEP;
  if (typeof event.getTargetRanges !== 'function') return ONE_STEP;
  const ranges = event.getTargetRanges();
  if (ranges.length !== 1) return ONE_STEP;
  const range = ranges[0]!;
  if (!range.startContainer.isConnected || !range.endContainer.isConnected) return ONE_STEP;
  const start = positionFromDomPoint(range.startContainer, range.startOffset, root);
  const end = positionFromDomPoint(range.endContainer, range.endOffset, root);
  if (!start || !end || samePosition(start, end)) return ONE_STEP;
  const caret = selection.head;
  if (samePosition(direction === 'backward' ? end : start, caret)) {
    const steps = stepsBetween(start, end, range, textOf);
    if (steps === null || steps < 1) return ONE_STEP;
    return { kind: 'steps', count: Math.min(steps, MAX_IME_DELETION_STEPS) };
  }
  if (browserSelectionTrusted) {
    const shown = semanticSelectionFromDom(root, root.ownerDocument.getSelection());
    const asRange = { anchor: start, head: end };
    if (shown && !samePosition(shown.anchor, shown.head)) {
      const startFirst = ordered(shown, start);
      if (selectionsEqual(startFirst, asRange)) return { kind: 'selection', selection: shown };
    }
  }
  return ONE_STEP;
}

/**
 * Run `count` deletion steps, stopping at the first one that changes nothing: the document
 * refused it, or there was nothing left to delete.
 */
export function runDeletionSteps(surface: PaginatedSurface, count: number, step: () => void): void {
  for (let index = 0; index < count; index += 1) {
    const before = surface.state();
    step();
    const after = surface.state();
    if (after.revision === before.revision && selectionsEqual(after.selection, before.selection))
      return;
  }
}

/** The `beforeinput` handler's deletion hooks, over the surface's live state. */
export function inputMethodDeletionHooks(deps: {
  readonly root: Element;
  selection(): SemanticSelection;
  textOf(paragraphId: string): string;
  readonly sync: Pick<SurfaceSelectionSync, 'browserSelectionTrusted' | 'noteInputMethodEdit'>;
}): {
  deletionPlan(event: InputEvent, direction: 'backward' | 'forward'): ImeDeletionPlan;
  onInputMethodDeletion(): void;
} {
  return {
    deletionPlan: (event, direction) =>
      imeDeletionPlan(
        event,
        deps.root,
        deps.selection(),
        deps.textOf,
        direction,
        deps.sync.browserSelectionTrusted()
      ),
    onInputMethodDeletion: () => deps.sync.noteInputMethodEdit(),
  };
}
