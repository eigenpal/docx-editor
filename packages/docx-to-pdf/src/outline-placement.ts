/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { number as n } from './context.ts';

/** One outline glyph placed on the page: its form, graphics state and glyph-to-page matrix. */
export interface OutlinePlacement {
  readonly state: string;
  readonly a: number;
  readonly c: number;
  readonly d: number;
  readonly x: number;
  readonly y: number;
  readonly form: string;
}

/** Relative moves larger than this start a new group, inside the number formatter's range. */
const MAX_OUTLINE_MOVE = 100_000;

const movable = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value) <= MAX_OUTLINE_MOVE;

/**
 * Operators that place outline forms. Placements that share colour, stroke and matrix share
 * one `q … cm`; each later one moves from the previous with a short translation in glyph
 * units, measured from where the WRITTEN numbers put the previous glyph, so rounding does not
 * accumulate along the line. A dense Arabic line otherwise spent half its content on a full
 * matrix per dot.
 */
export function outlineOperators(placements: readonly OutlinePlacement[]): string {
  const out: string[] = [];
  let group: OutlinePlacement | null = null;
  // The group matrix and the previous glyph's origin as the file states them.
  let [ra, rc, rd, px, py] = [1, 0, 1, 0, 0];
  for (const placement of placements) {
    const same =
      group !== null &&
      group.state === placement.state &&
      group.a === placement.a &&
      group.c === placement.c &&
      group.d === placement.d;
    // Raw quotients are checked BEFORE the number formatter, which throws past its range:
    // a small size at a large unitsPerEm turns a page-width move into millions of units.
    const rawV = same && rd !== 0 ? (placement.y - py) / rd : NaN;
    const v = movable(rawV) ? Number(n(rawV)) : NaN;
    const rawU = movable(v) && ra !== 0 ? (placement.x - px - rc * v) / ra : NaN;
    const u = movable(rawU) ? Number(n(rawU)) : NaN;
    if (movable(u) && movable(v)) {
      out.push(`1 0 0 1 ${n(u)} ${n(v)} cm /${placement.form} Do`);
      px += ra * u + rc * v;
      py += rd * v;
      continue;
    }
    if (group) out.push('Q');
    group = placement;
    const { a, c, d, x, y } = placement;
    out.push(`q ${placement.state}${[a, 0, c, d, x, y].map(n).join(' ')} cm /${placement.form} Do`);
    [ra, rc, rd, px, py] = [a, c, d, x, y].map((value) => Number(n(value))) as [
      number,
      number,
      number,
      number,
      number,
    ];
  }
  if (group) out.push('Q');
  return out.join('\n');
}
