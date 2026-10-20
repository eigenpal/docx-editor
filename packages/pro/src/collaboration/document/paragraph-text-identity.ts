/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The identity of each character of a paragraph's shared text, across moves.
 *
 * A character typed into a paragraph is its own Yjs item, and that item's ID is its identity.
 * Moving text to another paragraph deletes it there and inserts a copy, and a mark on the
 * copy's insert names the identity of the first character it copies (`paragraph-text-marks.ts`).
 * The characters of one insert have consecutive clocks, so each copied character's identity
 * is the mark's identity plus its clock's offset in the insert. Characters an undo put back
 * are marked the same way.
 *
 * Only what every replica holds alike is read: item IDs and clocks, item order, and the marks.
 * How a replica stores deleted items is its own: garbage collection merges neighboring
 * deleted items whatever they held.
 */
import * as Y from 'yjs';
import { firstItem, structAt, type ItemId } from './yjs-items.ts';
import { parseClientClock } from './identity.ts';
import { STAY, type FollowAnchor } from './paragraph-text-moves.ts';
import { MAX_MARK_CHAIN, marksOfText, type MarkLookup } from './paragraph-text-marks.ts';
import { textDeletionsOf } from './paragraph-text-deletions.ts';

/** `client:clock`, the form identities take as keys. */
export type Identity = string;

export interface TextIdentities {
  /** The identity of the character at each position of the text, null for an embed. */
  readonly ids: readonly (Identity | null)[];
  /** The identity at each position as numbers; -1 for an embed. */
  readonly clients: readonly number[];
  readonly clocks: readonly number[];
  /**
   * The Yjs item ID of each position, `client:clock`. It never changes while the character
   * lives, so it finds a character after writes move its position, also when a copy of it
   * in the same text has the same identity.
   */
  readonly items: readonly string[];
  /**
   * The Yjs item ID each position was inserted after (`items` form), per character: for a
   * character inside an insert, the one before it in that insert. Null at the start.
   */
  readonly origins: readonly (string | null)[];
  /** Whether the character at each position is a moved copy. */
  readonly moved: readonly boolean[];
  /** Whether the character at each position is a copy an undo or redo put back. */
  readonly restored: readonly boolean[];
  /**
   * Whether a participant deleted the character at each position (`paragraph-text-deletions`):
   * a copy of it a peer made at the same time shows nowhere.
   */
  readonly deleted: readonly boolean[];
  /**
   * For the first character of each item a peer inserted whose left neighbor has left this
   * text: where it can follow, nearest first. The item's follow attribute comes first, then
   * the deleted characters it was typed after. Null everywhere else.
   */
  readonly anchors: readonly (readonly FollowAnchor[] | null)[];
  /** Whether any position has anchors. */
  readonly hasAnchors: boolean;
  /** Whether each position is the first character of its Yjs item. */
  readonly starts: readonly boolean[];
  /**
   * For the first character of each item, the identity of the nearest character it was typed
   * after that is still in this text.
   */
  readonly lefts: readonly (Identity | null)[];
  /**
   * For the first character of each copy, the characters it went in after, nearest first:
   * the deleted ones, then the nearest one still in this text. Null everywhere else.
   */
  readonly copiedAfter: readonly (readonly Identity[] | null)[];
}

/**
 * How far a walk along typing origins goes. The walk visits one clock per step whatever each
 * replica collected, so a step limit cuts every replica's walk at the same clock. A limit on
 * the characters it offers would not: a replica that still holds a deleted marker skips it,
 * and one that collected it offers its clock.
 */
const MAX_ORIGIN_STEPS = 64;

/**
 * The identity of one clock, as numbers: through every mark, a copy's or a put-back
 * character's, or else its own ID.
 *
 * A mark names the item it copies, and that item can carry a mark of its own: a copy of a
 * copy, or a copy of characters an undo put back. The second mark can arrive later than the
 * copy, as an undo writes its marks after the undo, so the identity resolves through the
 * chain on every read rather than once when the copy was made. Every replica holds the same
 * marks, so every replica resolves alike, and the cap ends a chain that loops.
 */
function identityParts(marks: MarkLookup, client: number, clock: number): [number, number] {
  for (let depth = 0; depth < MAX_MARK_CHAIN; depth += 1) {
    const origin = marks.origin('move', client, clock) ?? marks.origin('restore', client, clock);
    if (!origin) break;
    const nextClient = origin.client;
    const nextClock = origin.clock + clock - origin.firstClock;
    if (nextClient === client && nextClock === clock) break;
    client = nextClient;
    clock = nextClock;
  }
  return [client, clock];
}

/** An identity resolved through every mark, as a stored anchor names it. */
function resolvedIdentity(marks: MarkLookup, identity: Identity): Identity {
  const parsed = parseClientClock(identity);
  return parsed ? identityIn(marks, parsed.client, parsed.clock) : identity;
}

function identityIn(marks: MarkLookup, client: number, clock: number): Identity {
  const [identityClient, identityClock] = identityParts(marks, client, clock);
  return `${identityClient}:${identityClock}`;
}

/** The identity of one character of an item of `text`, deleted or not. */
export function itemIdentity(text: Y.Text, item: Y.Item, offset: number): Identity {
  return identityIn(marksOfText(text), item.id.client, item.id.clock + offset);
}

/**
 * The clock a character was typed after: the item's origin for its first clock, the clock
 * before for the rest. Garbage collection merges an item only with the item typed right
 * after it, so this reads alike on every replica, whatever each one merged.
 */
function originOfClock(item: Y.Item, clock: number): ItemId | null {
  return clock === item.id.clock ? item.origin : { client: item.id.client, clock: clock - 1 };
}

interface LeftWalk {
  /** The nearest character still in the text, or null. */
  readonly live: Identity | null;
  /** Deleted characters passed on the way, nearest first, when the walk passed any. */
  readonly deleted: readonly Identity[];
}

/**
 * Walk back along what an item was typed after. Live format markers are skipped: typing with
 * new formatting writes markers first, so a character's origin can be a marker. Deleted
 * items are passed and offered as anchors; a deleted marker never has a copy, so offering it
 * costs nothing, and the walk cannot tell a collected marker from a collected character.
 */
function walkLeft(
  doc: Y.Doc,
  start: Y.Item,
  identityAt: (item: Y.Item, clock: number) => Identity | null
): LeftWalk {
  const deleted: Identity[] = [];
  // Most characters were typed right after their left neighbor: that one is the origin and
  // still in the text, so no store lookup is needed.
  const left = start.left;
  if (
    left &&
    start.origin &&
    !left.deleted &&
    !(left.content instanceof Y.ContentFormat) &&
    left.id.client === start.origin.client &&
    left.id.clock + left.length - 1 === start.origin.clock
  ) {
    return { live: identityAt(left, start.origin.clock), deleted };
  }
  let at: ItemId | null = start.origin;
  for (let steps = 0; at && steps < MAX_ORIGIN_STEPS; steps += 1) {
    const item = structAt(doc, at);
    if (!item) break;
    if (!item.deleted) {
      if (item.content instanceof Y.ContentFormat) {
        at = originOfClock(item, at.clock);
        continue;
      }
      return { live: identityAt(item, at.clock), deleted };
    }
    const identity = identityAt(item, at.clock);
    if (identity) deleted.push(identity);
    at = originOfClock(item, at.clock);
  }
  return { live: null, deleted };
}

/**
 * The character text was typed in front of: its right origin, past formatting markers still
 * in the text. Only that one: following text never anchors on other following text, so a
 * walk on through deleted characters reached text that shows elsewhere only by a chain, and
 * replicas that relocated in another order placed it differently.
 */
function typedInFrontOf(
  doc: Y.Doc,
  start: Y.Item,
  identityAt: (item: Y.Item, clock: number) => Identity | null
): Identity | null {
  let at: ItemId | null = start.rightOrigin;
  for (let steps = 0; at && steps < MAX_ORIGIN_STEPS; steps += 1) {
    const item = structAt(doc, at);
    if (!item) return null;
    if (item.deleted || !(item.content instanceof Y.ContentFormat)) {
      return identityAt(item, at.clock);
    }
    at = item.rightOrigin;
  }
  return null;
}

/**
 * The identity a walk offers for one clock: a live character's, or any deleted item's. A
 * deleted marker or embed is offered too, although it never has a copy, because garbage
 * collection turns it into an item that cannot be told from a deleted character. Offering
 * only characters made a replica that had not collected yet read the text differently.
 */
function offeredIdentity(marks: MarkLookup, item: Y.Item, clock: number): Identity | null {
  return item.deleted || item.content instanceof Y.ContentString
    ? identityIn(marks, item.id.client, clock)
    : null;
}

/** Whether the character at `position` is a copy: moved there, or put back by an undo. */
export function isCopyAt(
  identities: Pick<TextIdentities, 'moved' | 'restored'>,
  position: number
): boolean {
  return identities.moved[position] === true || identities.restored[position] === true;
}

/** The identities of a paragraph's shared text, read from its Yjs items. */
export function textIdentities(text: Y.Text): TextIdentities {
  const start = firstItem(text);
  const marks = marksOfText(text);
  const ids: (Identity | null)[] = [];
  const clients: number[] = [];
  const clocks: number[] = [];
  const items: string[] = [];
  const origins: (string | null)[] = [];
  const moved: boolean[] = [];
  const restored: boolean[] = [];
  const deleted: boolean[] = [];
  const deletions = text.doc ? textDeletionsOf(text.doc) : null;
  const anchors: (readonly FollowAnchor[] | null)[] = [];
  const starts: boolean[] = [];
  const lefts: (Identity | null)[] = [];
  const copiedAfter: (readonly Identity[] | null)[] = [];
  let hasAnchors = false;
  const doc = text.doc;
  const identityAt = (item: Y.Item, clock: number): Identity | null =>
    offeredIdentity(marks, item, clock);
  for (let item = start; item; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const isText = item.content instanceof Y.ContentString;
    // An embed, as a line break or a picture, was placed after a character as typing is, and
    // follows a move of that character the same way.
    const placed = isText || item.content instanceof Y.ContentEmbed;
    // Read per clock, never per item: replicas merge items differently, and one merged item
    // can hold clocks of two inserts.
    const movedAt = (clock: number): boolean =>
      isText && marks.origin('move', item.id.client, clock) !== null;
    const restoredAt = (clock: number): boolean =>
      isText && !movedAt(clock) && marks.origin('restore', item.id.client, clock) !== null;
    const isCopy = movedAt(item.id.clock) || restoredAt(item.id.clock);
    const stored = placed ? marks.follow(item.id.client, item.id.clock) : null;
    const follow =
      stored && stored.identity !== STAY
        ? { ...stored, identity: resolvedIdentity(marks, stored.identity) }
        : stored;
    const walk = doc ? walkLeft(doc, item, identityAt) : { live: null, deleted: [] };
    // A follow attribute is what the typer meant, so it is the only anchor. Without one, the
    // deleted characters the text was typed after are, nearest first.
    let anchor: FollowAnchor[] | null = null;
    if (placed && !isCopy && follow && (walk.deleted.length > 0 || walk.live === null)) {
      anchor = [follow];
    } else if (placed && !isCopy && walk.deleted.length > 0) {
      anchor = walk.deleted.map((identity) => ({ identity, before: false }));
    }
    if (anchor) hasAnchors = true;
    // Text typed at the start of a paragraph was typed after nothing, or after formatting
    // markers that never have copies, so it can also follow what it was typed in front of:
    // only out of a paragraph that is gone, as a peer's join into the paragraph before it
    // leaves it. A live paragraph never reads these anchors, so they do not make it a source.
    if (placed && !isCopy && !stored && walk.live === null && doc) {
      const right = typedInFrontOf(doc, item, identityAt);
      if (right) anchor = [...(anchor ?? []), { identity: right, before: true }];
    }
    const after = isCopy ? [...walk.deleted, ...(walk.live === null ? [] : [walk.live])] : null;
    for (let offset = 0; offset < item.length; offset += 1) {
      items.push(`${item.id.client}:${item.id.clock + offset}`);
      origins.push(
        offset > 0
          ? `${item.id.client}:${item.id.clock + offset - 1}`
          : item.origin
            ? `${item.origin.client}:${item.origin.clock}`
            : null
      );
      if (isText) {
        const [client, clock] = identityParts(marks, item.id.client, item.id.clock + offset);
        ids.push(`${client}:${clock}`);
        clients.push(client);
        clocks.push(clock);
      } else {
        ids.push(null);
        clients.push(-1);
        clocks.push(-1);
      }
      moved.push(movedAt(item.id.clock + offset));
      const isRestored = restoredAt(item.id.clock + offset);
      restored.push(isRestored);
      deleted.push(
        isText &&
          deletions !== null &&
          deletions.isDeleted(clients[clients.length - 1]!, clocks[clocks.length - 1]!)
      );
      starts.push(offset === 0);
      lefts.push(offset === 0 ? walk.live : null);
      copiedAfter.push(offset === 0 ? after : null);
      anchors.push(offset === 0 ? anchor : null);
    }
  }
  return {
    ids,
    clients,
    clocks,
    items,
    origins,
    moved,
    restored,
    deleted,
    anchors,
    hasAnchors,
    starts,
    lefts,
    copiedAfter,
  };
}

/**
 * Whether any character an item of `text` was typed after, live or deleted, has a shown copy,
 * in this paragraph or another. A typist who types after such a character knows of its move,
 * even when the character next to the new text is live: deleting that neighbor later exposes
 * the moved character behind it, or a split moves its copy away, and text that did not mark
 * itself would then follow the move.
 */
export function typedAfterMoved(
  text: Y.Text,
  item: Y.Item,
  hasShownCopy: (identity: Identity) => boolean
): boolean {
  const doc = text.doc;
  if (!doc) return false;
  const marks = marksOfText(text);
  let at: ItemId | null = item.origin;
  for (let steps = 0; at && steps < MAX_ORIGIN_STEPS; steps += 1) {
    const left = structAt(doc, at);
    if (!left) return false;
    const identity = offeredIdentity(marks, left, at.clock);
    if (identity !== null && hasShownCopy(identity)) return true;
    at = originOfClock(left, at.clock);
  }
  return false;
}
