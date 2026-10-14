/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Where the review pane's cards sit, shared so the React and Vue rails cannot drift.

/** One card slot in document order. `anchorY` is in layout points, null before placement. */
export interface RailStackEntry {
  readonly key: string;
  readonly anchorY: number | null;
  /** The open card stays at its own text; the cards around it make room. */
  readonly isActive?: boolean;
}

export interface RailStackOptions {
  /** CSS pixels between cards. */
  readonly gap: number;
  /** Layout points to CSS pixels. */
  readonly scale: number;
  /** A card pushed further than this from its text, in CSS pixels, collapses. */
  readonly collapseAfterPx: number;
  /** A card's height in CSS pixels, full or collapsed. */
  readonly heightOf: (key: string, collapsed: boolean) => number;
  /** Whether this card may collapse at all. The open card never does. */
  readonly collapsible: (entry: RailStackEntry) => boolean;
}

export interface RailStack {
  /** Each card's top, in layout points. */
  readonly positions: ReadonlyMap<string, number>;
  /** The cards pushed far enough from their text to collapse. */
  readonly collapsed: ReadonlySet<string>;
}

/**
 * Stack cards so none overlap, keeping the open card beside its text.
 *
 * Without an open card, the run goes top-down: each card sits at its text or just below the
 * card before it. With one, that card sits exactly at its text. The cards before it move up
 * as far as they must, and the cards after it move down. A dense page otherwise pushed the
 * open card below the pane while its text was in view, so Next Change highlighted text whose
 * card nobody could see. When several cards are open, as the two halves of a replacement are,
 * the first one anchors and the rest follow it.
 */
export function stackRailCards(
  entries: readonly RailStackEntry[],
  options: RailStackOptions
): RailStack {
  const positions = new Map<string, number>();
  const collapsed = new Set<string>();
  const { gap, scale } = options;
  const span = (entry: RailStackEntry, folded: boolean) =>
    (options.heightOf(entry.key, folded) + gap) / scale;
  const folds = (entry: RailStackEntry, top: number) =>
    entry.anchorY !== null &&
    Math.abs(top - entry.anchorY) * scale > options.collapseAfterPx &&
    !entry.isActive &&
    options.collapsible(entry);

  const pinned = entries.findIndex((entry) => entry.isActive && entry.anchorY !== null);
  // Downward from the pinned card, or from the top when nothing is open.
  let cursor = Number.NEGATIVE_INFINITY;
  for (let index = Math.max(pinned, 0); index < entries.length; index += 1) {
    const entry = entries[index]!;
    // A card with no geometry yet keeps its place after the card before it. Without a
    // `top` it would fall back into normal flow under the absolutely positioned cards.
    const top =
      entry.anchorY === null
        ? Number.isFinite(cursor)
          ? cursor
          : 0
        : Math.max(entry.anchorY, cursor);
    positions.set(entry.key, top);
    const folded = folds(entry, top);
    if (folded) collapsed.add(entry.key);
    cursor = top + span(entry, folded);
  }
  // Upward from the pinned card: each earlier card ends above the card after it.
  for (let index = pinned - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const below = positions.get(entries[index + 1]!.key)!;
    const place = (folded: boolean) => {
      const limit = below - span(entry, folded);
      return entry.anchorY === null ? limit : Math.min(entry.anchorY, limit);
    };
    // Decide from the FOLDED height, which never changes. The rail measures a card as it is
    // drawn, so a folded card reports its folded height as its full one on the next pass. A
    // decision from that height unfolded the card, which then measured full and folded
    // again, until React gave up on the loop.
    const folded = folds(entry, place(true));
    if (folded) collapsed.add(entry.key);
    positions.set(entry.key, place(folded));
  }
  return { positions, collapsed };
}
