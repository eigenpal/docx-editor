/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Where text that follows a move shows in a paragraph.
 *
 * The view shows following text by this placement, and an adoption writes it by the same
 * placement, so a write reads the paragraph in the order the editor showed it. When the two
 * placed a piece differently, a write read the paragraph reordered: it typed the piece again
 * without its identity and recorded the original as deleted.
 *
 * A piece shows after (or, with `before`, before) the first shown character of the paragraph
 * that has its anchor's identity. When no shown character has it, the piece shows at the
 * first character of another piece that has it, so text typed inside moved text stays inside
 * it, after the characters of that piece inserted after the anchor: a later insert after one
 * character shows before what followed that character, as it did to its typist. A piece whose
 * anchor shows nowhere here shows at the end.
 */
import { isNextClock } from './identity.ts';
import type { FollowingText, ShownText } from './paragraph-text-follow.ts';

/** How deep pieces nest inside other pieces. A deeper piece shows at the end. */
export const MAX_FOLLOW_NESTING = 8;

/** The pieces that show before and after one character, in the order they show. */
export interface FollowingSlot {
  readonly before: readonly FollowingText[];
  readonly after: readonly FollowingText[];
}

export interface FollowingPlacement {
  /** Pieces at a shown character of the paragraph's own text, by its position. */
  readonly atPosition: ReadonlyMap<number, FollowingSlot>;
  /** Pieces at a character of another piece: by that piece, then by the character's index. */
  readonly inside: ReadonlyMap<FollowingText, ReadonlyMap<number, FollowingSlot>>;
  /** Pieces whose anchor shows nowhere here, in the order they show at the end. */
  readonly atEnd: readonly FollowingText[];
}

interface MutableSlot {
  readonly before: FollowingText[];
  readonly after: FollowingText[];
}

/** Where each piece of `shown.incoming` shows. */
export function placeFollowingText(shown: ShownText): FollowingPlacement {
  const firstShown = new Map<string, number>();
  shown.identities.ids.forEach((identity, position) => {
    if (identity && !shown.hidden.has(position) && !firstShown.has(identity)) {
      firstShown.set(identity, position);
    }
  });
  const firstInPiece = new Map<string, { readonly piece: FollowingText; readonly index: number }>();
  for (const piece of shown.incoming) {
    piece.identities.forEach((identity, index) => {
      if (identity && !firstInPiece.has(identity)) firstInPiece.set(identity, { piece, index });
    });
  }
  const parentOf = new Map<
    FollowingText,
    { readonly piece: FollowingText; readonly index: number }
  >();
  for (const piece of shown.incoming) {
    if (firstShown.has(piece.after)) continue;
    const host = firstInPiece.get(piece.after);
    if (host && host.piece !== piece) parentOf.set(piece, afterInserts(piece, host, shown));
  }
  // A piece inside another shows only when that one shows. In a cycle, or below the nesting
  // limit, none of the chain would show, so the first such piece shows at the end instead.
  const shows = (piece: FollowingText): boolean => {
    let current = piece;
    for (let depth = 0; depth <= MAX_FOLLOW_NESTING; depth += 1) {
      const parent = parentOf.get(current);
      if (!parent) return true;
      current = parent.piece;
    }
    return false;
  };
  for (;;) {
    const stuck = shown.incoming.find((piece) => parentOf.has(piece) && !shows(piece));
    if (!stuck) break;
    parentOf.delete(stuck);
  }
  const atPosition = new Map<number, MutableSlot>();
  const inside = new Map<FollowingText, Map<number, MutableSlot>>();
  const atEnd: FollowingText[] = [];
  const slotIn = <K>(map: Map<K, MutableSlot>, key: K): MutableSlot => {
    let slot = map.get(key);
    if (!slot) {
      slot = { before: [], after: [] };
      map.set(key, slot);
    }
    return slot;
  };
  for (const piece of shown.incoming) {
    const position = firstShown.get(piece.after);
    const parent = parentOf.get(piece);
    let slot: MutableSlot | null = null;
    if (position !== undefined) slot = slotIn(atPosition, position);
    else if (parent) {
      let slots = inside.get(parent.piece);
      if (!slots) {
        slots = new Map();
        inside.set(parent.piece, slots);
      }
      slot = slotIn(slots, parent.index);
    }
    if (!slot) atEnd.push(piece);
    else if (piece.before) slot.before.push(piece);
    else slot.after.push(piece);
  }
  return { atPosition, inside, atEnd };
}

/**
 * The character of `host.piece` that `piece` shows after: its anchor, or past the anchor,
 * the host's characters inserted after the anchor, as Yjs orders a later insert after one
 * character before the text that followed it. Read where the host stands in this paragraph's
 * own text, which records each character's insert origin.
 */
function afterInserts(
  piece: FollowingText,
  host: { readonly piece: FollowingText; readonly index: number },
  shown: ShownText
): { readonly piece: FollowingText; readonly index: number } {
  if (piece.before) return host;
  const { positions, items } = host.piece;
  const { items: here, origins } = shown.identities;
  const anchor = items[host.index];
  // Only a host that stands in this text, item for item, has its origins here.
  if (anchor === undefined || here[positions[host.index]!] !== anchor) return host;
  // The character that followed the anchor in its own insert came with it, not after it.
  const sameInsert = (item: string): boolean => isNextClock(anchor, item);
  const inserted = new Set<string>();
  let index = host.index;
  for (let next = index + 1; next < positions.length; next += 1) {
    const item = items[next]!;
    const position = positions[next]!;
    const origin = here[position] === item ? origins[position] : null;
    const afterAnchor = origin === anchor && !sameInsert(item);
    if (!afterAnchor && !(origin !== null && inserted.has(origin))) break;
    inserted.add(item);
    index = next;
  }
  return { piece: host.piece, index };
}
