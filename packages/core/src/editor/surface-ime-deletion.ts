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
// So the range is believed for HOW MUCH to delete, and only where it is anchored at a caret:
// the model's, or the browser's own when a paint is still a commit behind the model (both
// endpoints then map through the same older paint, so their distance still holds). The
// deletion runs as that many ordinary Backspace (or Delete) steps at the MODEL caret. Every
// rule those keys follow — fields, content controls, list numbers and indents before a join,
// table cells, tracked changes — applies unchanged, exactly as the same presses on a hardware
// key would, and a step the document refuses ends the run rather than being retried. A range
// that is not anchored deletes one step at the caret, which is what the key the user pressed
// means. The single exception is a range the browser itself SELECTS: a keyboard can select a
// word and then delete it, and that selection deletes as a selection.

import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  positionFromDomPoint,
  selectionsEqual,
  semanticSelectionFromDom,
} from './dom-selection.ts';
import type { HostTimers } from './host-realm.ts';
import { PAINTED_FURNITURE } from './surface-composition-readback.ts';
import {
  createBrowserMutationRepair,
  type BrowserMutationRepair,
} from './surface-browser-mutation-repair.ts';
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

/** What the planner reads from the surface. */
export interface ImeDeletionContext {
  readonly root: Element;
  readonly selection: SemanticSelection;
  textOf(paragraphId: string): string;
  /** The paragraph before `paragraphId` in its story, or undefined at the story start. */
  previousParagraph(paragraphId: string): string | undefined;
  /** False while an input method may still be correcting the browser's selection. */
  readonly browserSelectionTrusted: boolean;
  /** Whether the painted DOM shows the model's revision, not a paint deferred behind it. */
  readonly paintCurrent: boolean;
}

function samePosition(a: SemanticPosition, b: SemanticPosition): boolean {
  return a.paragraphId === b.paragraphId && a.offset === b.offset;
}

/**
 * How many single steps `[start, end)` holds: one per UTF-16 unit, the unit one Backspace
 * removes, and one for the break between two NEIGHBOURING paragraphs, which one Backspace
 * joins. Anything wider — two breaks, a range into a header or a note — is not a count the
 * story order can vouch for, and is not counted.
 */
function stepsBetween(
  start: SemanticPosition,
  end: SemanticPosition,
  context: ImeDeletionContext
): number | null {
  if (start.paragraphId === end.paragraphId) return end.offset - start.offset;
  if (context.previousParagraph(end.paragraphId) !== start.paragraphId) return null;
  return context.textOf(start.paragraphId).length - start.offset + 1 + end.offset;
}

/** `NodeFilter.SHOW_TEXT`, as a number: the constructor belongs to whichever window. */
const SHOW_TEXT = 0x4;

/**
 * The document characters the range paints, or null when it cannot be read. Model offsets
 * also count what never paints — a hidden run, a struck revision a resolved view hides — and
 * the keyboard cannot have meant those: it names what it was shown. Furniture glyphs inside
 * the range (a tab leader's dots, a picture's label) are not document characters either.
 */
function paintedLength(range: StaticRange): number | null {
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
  const scope = common.nodeType === Node.ELEMENT_NODE ? common : common.parentNode;
  if (!scope) return null;
  const walker = doc.createTreeWalker(scope, SHOW_TEXT);
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!live.intersectsNode(node)) continue;
    if (node.parentElement?.closest(PAINTED_FURNITURE)) continue;
    const text = node as Text;
    const from = node === live.startContainer ? live.startOffset : 0;
    const to = node === live.endContainer ? live.endOffset : text.data.length;
    length += Math.max(0, to - from);
  }
  return length;
}

/** The range ordered start-first, whichever way the user extended it. */
function ordered(selection: SemanticSelection, start: SemanticPosition): SemanticSelection {
  return samePosition(selection.anchor, start)
    ? selection
    : { anchor: selection.head, head: selection.anchor };
}

/** Decide how one `deleteContentBackward` / `deleteContentForward` event deletes. */
export function imeDeletionPlan(
  event: InputEvent,
  context: ImeDeletionContext,
  direction: 'backward' | 'forward'
): ImeDeletionPlan {
  const { root, selection } = context;
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
  const anchor = direction === 'backward' ? end : start;
  const shown = semanticSelectionFromDom(root, root.ownerDocument.getSelection());
  const atBrowserCaret =
    shown !== null && samePosition(shown.anchor, shown.head) && samePosition(shown.head, anchor);
  // The browser can select the range it is about to delete before it says so: it is then the
  // browser's selection, and still the keyboard's batched presses.
  const rangeShown =
    shown !== null &&
    !samePosition(shown.anchor, shown.head) &&
    selectionsEqual(ordered(shown, start), { anchor: start, head: end });
  if (
    samePosition(anchor, selection.head) ||
    atBrowserCaret ||
    (rangeShown && !context.paintCurrent)
  ) {
    const steps = stepsBetween(start, end, context);
    const painted = paintedLength(range);
    if (steps === null || painted === null) return ONE_STEP;
    // A break paints nothing; it is the one step a join takes.
    const shownSteps = painted + (start.paragraphId === end.paragraphId ? 0 : 1);
    const count = Math.min(steps, shownSteps, MAX_IME_DELETION_STEPS);
    return count < 1 ? ONE_STEP : { kind: 'steps', count };
  }
  // A selection read from a paint behind the model names offsets that have since moved.
  if (rangeShown && context.browserSelectionTrusted && context.paintCurrent)
    return { kind: 'selection', selection: shown! };
  return ONE_STEP;
}

/**
 * Run `count` deletion steps, stopping at the first one that changes nothing: the document
 * refused it, or there was nothing left to delete. `revision` is the document's edit clock.
 */
export function runDeletionSteps(
  revision: () => number,
  selection: () => SemanticSelection,
  count: number,
  step: () => void
): void {
  for (let index = 0; index < count; index += 1) {
    const before = revision();
    const caret = selection();
    step();
    if (index + 1 < count && revision() === before && selectionsEqual(selection(), caret)) return;
  }
}

/**
 * The input method lane of the `beforeinput` handler: its deletion hooks, over the surface's
 * live state, and the repair of an edit the browser applied anyway.
 */
export function createInputMethodLane(deps: {
  readonly pagesLayer: HTMLElement;
  selection(): SemanticSelection;
  textOf(paragraphId: string): string;
  /** The active story's paragraphs in document order. */
  paragraphOrder(): readonly string[];
  /** The document's edit clock. */
  revision(): number;
  /** Whether the painted DOM shows the model's revision. */
  paintCurrent(): boolean;
  render(notifyChange: boolean): void;
  readonly timers: HostTimers;
  readonly sync: Pick<SurfaceSelectionSync, 'browserSelectionTrusted' | 'noteInputMethodEdit'>;
}): {
  readonly hooks: {
    deletionPlan(event: InputEvent, direction: 'backward' | 'forward'): ImeDeletionPlan;
    runDeletionSteps(count: number, step: () => void): void;
    onInputMethodDeletion(): void;
  };
  readonly repair: BrowserMutationRepair;
} {
  return {
    hooks: {
      deletionPlan: (event, direction) =>
        imeDeletionPlan(
          event,
          {
            root: deps.pagesLayer,
            selection: deps.selection(),
            textOf: deps.textOf,
            previousParagraph: (id) => {
              const order = deps.paragraphOrder();
              return order[order.indexOf(id) - 1];
            },
            browserSelectionTrusted: deps.sync.browserSelectionTrusted(),
            paintCurrent: deps.paintCurrent(),
          },
          direction
        ),
      runDeletionSteps: (count, step) =>
        runDeletionSteps(deps.revision, deps.selection, count, step),
      onInputMethodDeletion: () => deps.sync.noteInputMethodEdit(),
    },
    repair: createBrowserMutationRepair(deps),
  };
}
