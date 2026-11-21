// Caret motion around a generated table of contents. Its cached rows are read-only, so a
// motion that lands inside them crosses the region, stops on an editable closing line, or
// falls back to the nearest editable position on its own side. A Shift motion moves the
// selection head by the same rule, so a selection can extend onto or across a TOC.

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { DetectedToc } from '../store/package/toc-detect.ts';
import type { NavigationCommand, SemanticPosition } from '../layout/semantic-interaction.ts';
import {
  tocAtPosition,
  tocParagraphRanges,
  tocSkippedByCaretMotion,
} from './surface-toc-ranges.ts';

/** The part of a navigation result this lane reads. */
interface CaretMove {
  readonly position: SemanticPosition;
  readonly desiredX: number | null;
  readonly caret?: unknown;
}

/** One caret step from a position, or null at the end of the story. */
export type TocCaretStep<M extends CaretMove> = (from: M, command: NavigationCommand) => M | null;

const BACKWARD_MOTIONS: ReadonlySet<NavigationCommand> = new Set([
  'left',
  'wordLeft',
  'lineStart',
  'up',
  'pageUp',
  'documentStart',
]);

/** Motions that step through text rather than by line. */
const TEXT_MOTIONS: ReadonlySet<NavigationCommand> = new Set([
  'left',
  'right',
  'wordLeft',
  'wordRight',
]);

/** Whether a motion moves toward the start of the document. */
export function isBackwardMotion(command: NavigationCommand): boolean {
  return BACKWARD_MOTIONS.has(command);
}

const samePosition = (a: SemanticPosition, b: SemanticPosition) =>
  a.paragraphId === b.paragraphId && a.offset === b.offset;

/**
 * Where a motion from `origin` that landed at `moved` settles, or null when the caret
 * stays. A position outside every TOC is returned unchanged.
 *
 * A text motion (Left, Right, and the word steps) continues at the editable text next to
 * the TOC. A line motion steps by LINE and keeps its column: a character step inside a
 * row that holds text lands in the same row, so a bounded loop could neither enter nor
 * cross the region. `lineLimit` bounds the steps by the lines the TOC regions occupy.
 */
export function settleTocMotion<M extends CaretMove>(
  part: OoxmlPart,
  origin: SemanticPosition,
  landed: M,
  command: NavigationCommand,
  step: TocCaretStep<M>,
  lineLimit: number
): M | null {
  let moved = landed;
  if (!tocSkippedByCaretMotion(part, moved.position, origin)) return moved;
  const backward = isBackwardMotion(command);
  if (TEXT_MOTIONS.has(command)) {
    const position = crossByText(part, origin, moved.position, backward, (from, motion) =>
      step({ ...moved, position: from, desiredX: null }, motion)
    );
    return position ? { ...moved, position, desiredX: null, caret: undefined } : null;
  }
  // The nearest editable closing line crossed: the stop when the region has no exit.
  let closingLine = tocAtPosition(part, moved.position) ? undefined : moved;
  for (let index = 0; index < lineLimit; index += 1) {
    const next = step(moved, backward ? 'up' : 'down');
    // Only a position that does not move at all is a dead end. A closing line with nothing
    // past it is still editable, so the caret can stop there.
    if (!next || samePosition(next.position, moved.position)) break;
    moved = next;
    if (!tocSkippedByCaretMotion(part, moved.position, origin)) return moved;
    if (!closingLine && !tocAtPosition(part, moved.position)) closingLine = moved;
  }
  const toc = tocAtPosition(part, moved.position);
  if (!toc) return moved;
  if (closingLine) return closingLine;
  // Nothing editable lies past the TOC in the motion's direction: Ctrl+End before a TOC
  // that ends the document, Ctrl+Home after one that starts it. Stop at the nearest
  // editable position on the origin's side instead.
  const position = editableBeside(part, toc, backward ? 'after' : 'before', (from, command) =>
    step({ ...moved, position: from, desiredX: null }, command)
  );
  return position ? { ...moved, position, desiredX: null, caret: undefined } : null;
}

/**
 * Where a text motion that landed in a TOC continues: the editable text beside the region.
 * A closing line that the motion arrives at from another paragraph is crossed too, and is
 * the stop when nothing editable lies past it.
 */
function crossByText<M extends CaretMove>(
  part: OoxmlPart,
  origin: SemanticPosition,
  landed: SemanticPosition,
  backward: boolean,
  step: (from: SemanticPosition, command: NavigationCommand) => M | null
): SemanticPosition | null {
  let position = landed;
  let closingLine: SemanticPosition | null = null;
  // Each pass crosses one TOC or one closing line, so the range count bounds the walk.
  for (let pass = 0; pass <= tocParagraphRanges(part).length; pass += 1) {
    const toc = tocSkippedByCaretMotion(part, position, origin);
    if (!toc) return position;
    let next: SemanticPosition | null;
    if (tocAtPosition(part, position)) {
      next = editableBeside(part, toc, backward ? 'before' : 'after', step);
    } else {
      closingLine = position;
      const stepped = step(position, backward ? 'left' : 'right')?.position;
      next = stepped && !samePosition(stepped, position) ? stepped : null;
    }
    if (!next) return closingLine;
    position = next;
  }
  return closingLine;
}

/** The nearest editable position before or after a TOC, crossing adjacent TOCs. */
function editableBeside<M extends CaretMove>(
  part: OoxmlPart,
  start: DetectedToc,
  side: 'before' | 'after',
  step: (from: SemanticPosition, command: NavigationCommand) => M | null
): SemanticPosition | null {
  const ranges = tocParagraphRanges(part);
  let toc = start;
  // Each pass crosses one TOC, so the TOC count bounds the walk.
  for (let pass = 0; pass <= ranges.length; pass += 1) {
    const edge = ranges.find(
      (r) => r.toc.id === toc.id && (side === 'after' ? r.endsHere : r.startsHere)
    );
    if (!edge) return null;
    if (side === 'before' && edge.start > 0) {
      return { paragraphId: edge.paragraphId, offset: edge.start };
    }
    // Ordinary text after the end mark, or a closing line that holds only the mark.
    if (side === 'after' && (edge.end < edge.length || (edge.length === 0 && !edge.startsHere))) {
      return { paragraphId: edge.paragraphId, offset: edge.end };
    }
    const from = { paragraphId: edge.paragraphId, offset: side === 'after' ? edge.length : 0 };
    const next = step(from, side === 'after' ? 'right' : 'left');
    if (!next || samePosition(next.position, from)) return null;
    const inside = tocAtPosition(part, next.position);
    if (!inside) return next.position;
    toc = inside;
  }
  return null;
}
