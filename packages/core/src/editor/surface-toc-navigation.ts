// Caret motion around a generated table of contents. Its cached rows are read-only, so a
// motion that lands inside them crosses the region to the next editable position, which can
// be the closing line, or falls back to the nearest editable position on its own side. A
// Shift motion moves the selection head by the same rule.

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { DetectedToc } from '../store/package/toc-detect.ts';
import type { NavigationCommand, SemanticPosition } from '../layout/semantic-interaction.ts';
import { tocAtPosition, tocEscapePosition, tocParagraphRanges } from './surface-toc-ranges.ts';
import { tocFieldChromeParagraphIds } from '../layout/toc-layout.ts';

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

/**
 * Motions that `settleTocMotion` places without first escaping to the TOC's edge: Home and
 * End stay in their paragraph, and line motions keep their column.
 */
const SETTLED_MOTIONS: ReadonlySet<NavigationCommand> = new Set([
  'lineStart',
  'lineEnd',
  'up',
  'down',
  'pageUp',
  'pageDown',
]);

/**
 * The edge of the TOC a text or document motion that landed in generated text escapes to,
 * before `settleTocMotion` runs. Null when the motion settles on its own or landed outside.
 */
export function tocMotionEscape(
  part: OoxmlPart,
  landed: SemanticPosition,
  command: NavigationCommand
): SemanticPosition | null {
  if (SETTLED_MOTIONS.has(command)) return null;
  return tocEscapePosition(part, landed, isBackwardMotion(command));
}

/** Whether a motion moves toward the start of the document. */
function isBackwardMotion(command: NavigationCommand): boolean {
  return BACKWARD_MOTIONS.has(command);
}

const samePosition = (a: SemanticPosition, b: SemanticPosition) =>
  a.paragraphId === b.paragraphId && a.offset === b.offset;

/**
 * Where a motion from `origin` that landed at `moved` settles, or null when the caret
 * stays. A position outside every TOC is returned unchanged.
 *
 * A text motion (Left, Right, and the word steps) continues at the editable position next
 * to the TOC. Home and End stay in their paragraph, at the edge of its ordinary text. A
 * line motion steps by LINE and keeps its column: a character step inside a row that holds
 * text lands in the same row, so a bounded loop could neither enter nor cross the region.
 * `lineLimit` bounds the steps by the lines the TOC regions occupy. A closing line is
 * editable, so every motion can stop on it.
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
  const landedIn = tocAtPosition(part, moved.position);
  if (!landedIn) return moved;
  const backward = isBackwardMotion(command);
  const settle = (position: SemanticPosition | null) =>
    position ? { ...moved, position, desiredX: null, caret: undefined } : null;
  const stepFrom = (from: SemanticPosition, motion: NavigationCommand) =>
    step({ ...moved, position: from, desiredX: null }, motion);
  if (command === 'lineStart' || command === 'lineEnd') {
    const edge = lineEdge(part, landedIn, origin, moved.position);
    if (edge) return settle(edge);
  }
  if (TEXT_MOTIONS.has(command)) {
    return settle(editableBeside(part, landedIn, backward ? 'before' : 'after', stepFrom));
  }
  for (let index = 0; index < lineLimit; index += 1) {
    const next = step(moved, backward ? 'up' : 'down');
    // Only a position that does not move at all is a dead end.
    if (!next || samePosition(next.position, moved.position)) break;
    moved = next;
    if (!tocAtPosition(part, moved.position)) return moved;
  }
  const toc = tocAtPosition(part, moved.position);
  if (!toc) return moved;
  // Nothing editable lies past the TOC in the motion's direction: Ctrl+End before a TOC
  // that ends the document, Ctrl+Home after one that starts it. Stop at the nearest
  // editable position on the origin's side instead.
  return settle(editableBeside(part, toc, backward ? 'after' : 'before', stepFrom));
}

/**
 * Where Home or End stops when its line end lies in generated text of the caret's own
 * paragraph: the edge of the ordinary text the caret is in.
 */
function lineEdge(
  part: OoxmlPart,
  toc: DetectedToc,
  origin: SemanticPosition,
  landed: SemanticPosition
): SemanticPosition | null {
  if (landed.paragraphId !== origin.paragraphId) return null;
  const range = tocParagraphRanges(part).find(
    (r) => r.toc.id === toc.id && r.paragraphId === origin.paragraphId
  );
  if (!range) return null;
  if (origin.offset >= range.end) return { paragraphId: origin.paragraphId, offset: range.end };
  if (origin.offset <= range.start) return { paragraphId: origin.paragraphId, offset: range.start };
  return null;
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
    // Ordinary text after the end mark, or a shown closing line that holds only the mark.
    // A TOC without cached rows hides its closing line, so the caret cannot stop there.
    const shownClosing =
      edge.length === 0 &&
      !edge.startsHere &&
      !tocFieldChromeParagraphIds(part).has(edge.paragraphId);
    if (side === 'after' && (edge.end < edge.length || shownClosing)) {
      return { paragraphId: edge.paragraphId, offset: edge.end };
    }
    // A hidden closing line has no caret position to step from; its TOC's first line does.
    const hidden = side === 'after' && tocFieldChromeParagraphIds(part).has(edge.paragraphId);
    const origin = hidden ? ranges.find((r) => r.toc.id === toc.id && r.startsHere)! : edge;
    const from = { paragraphId: origin.paragraphId, offset: side === 'after' ? origin.length : 0 };
    const next = step(from, side === 'after' ? 'right' : 'left');
    if (!next || samePosition(next.position, from)) return null;
    const inside = tocAtPosition(part, next.position);
    if (!inside) return next.position;
    toc = inside;
  }
  return null;
}
