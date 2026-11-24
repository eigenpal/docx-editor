// Turns of text-box stories, for geometry read from the story walks.
//
// A text box whose text turns (vertical text, text that turns with its shape, or a member of
// a turned drawing group) lays its story out upright and paints it turned about a pivot. A
// consumer that adds the story origin to a record's box gets the upright box; the turns of
// the story context carry that box to where the story paints. DOM-free.

import type { LayoutBox } from './semantic-records.ts';

/**
 * One clockwise turn of a text-box story about `pivot`, in page-stack points. The pivot is
 * where the turn sits before any outer turn moves it.
 *
 * @public
 */
export interface StoryTurn {
  /** Clockwise turn, in degrees. */
  readonly degrees: number;
  /** Point the story turns about, in page-stack points. */
  readonly pivot: Readonly<{ x: number; y: number }>;
}

/** A point of an upright story, carried through `turns`, innermost first. @public */
export function turnStoryPoint(
  turns: readonly StoryTurn[] | undefined,
  point: Readonly<{ x: number; y: number }>
): Readonly<{ x: number; y: number }> {
  if (!turns || turns.length === 0) return point;
  let { x, y } = point;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const { degrees, pivot } = turns[index]!;
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = x - pivot.x;
    const dy = y - pivot.y;
    x = pivot.x + dx * cos - dy * sin;
    y = pivot.y + dx * sin + dy * cos;
  }
  return Object.freeze({ x, y });
}

/**
 * The page-stack bounds of an upright story box once `turns` carry it: the box itself when the
 * story is upright, and the bounds of its turned corners otherwise. A quarter turn keeps the
 * box exact; another angle gives the smallest upright box around it.
 *
 * @public
 */
export function turnStoryBox(turns: readonly StoryTurn[] | undefined, box: LayoutBox): LayoutBox {
  if (!turns || turns.length === 0) return box;
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ].map((corner) => turnStoryPoint(turns, corner));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return Object.freeze({ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y });
}
