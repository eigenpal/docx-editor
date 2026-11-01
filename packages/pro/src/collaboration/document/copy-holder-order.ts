/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Which of the paragraphs that hold a moved copy of one character shows it.
 *
 * Two peers that split one paragraph at once each copy the tail after their own split point,
 * so the text after both points has a copy in both new paragraphs. The paragraph whose split
 * fell later holds the text after both points, and shows it. Document order told that only
 * while the two paragraphs stood where their splits put them: a peer that later moved the
 * paragraph with the earlier split below the other one made it show the other one's text
 * too, and left the other one empty.
 *
 * So where each holder's copy starts decides first. For a character of a live paragraph text,
 * the source, each holder's key is the place in the source of the first character the holder
 * holds a moved copy of, deleted or not, that the source holds too: as its own character, or
 * as a copy it holds itself, as a paragraph split off a split paragraph does. The copy whose
 * key stands later in the source shows, as a later split point does. A join copies a
 * paragraph from its start, so its key is that start, also when the joined paragraph begins
 * with copies of another text. A deleted copy keeps its identity and its mark, and a block
 * move changes no text, so the keys stay while peers edit and move the paragraphs. Document
 * order decides between holders with the same key. A holder with no key gives way to one
 * with a key. The comparison is one key per holder, so it orders every holder of a character
 * in one order and exactly one of them shows it.
 *
 * The keys read only shared text, marks, and item order, which every replica holds alike once
 * it holds the same updates. Only a live text gives places: a deleted paragraph's text is
 * collected on a replica with garbage collection and kept on one without, so a character of
 * a deleted text falls back to document order on every replica.
 */
import * as Y from 'yjs';
import { parseClientClock, type LogicalId } from './identity.ts';
import { itemIdentity, type Identity } from './paragraph-text-identity.ts';
import { marksOfText } from './paragraph-text-marks.ts';
import { firstItem, structAt } from './yjs-items.ts';

/** Negative when paragraph `a` comes before paragraph `b` in the document. */
type Order = (a: LogicalId, b: LogicalId) => number;

/** How many paragraphs keep their keys between reads. */
const MAX_CACHED = 4096;

/** The item that holds a character, and its live text, or null when it has none. */
function placeOf(doc: Y.Doc, identity: Identity): { item: Y.Item; text: Y.Text } | null {
  const parsed = parseClientClock(identity);
  const item = parsed ? structAt(doc, parsed) : null;
  const text = item?.parent;
  if (!item || !(text instanceof Y.Text)) return null;
  for (
    let holder = text._item;
    holder;
    holder = holder.parent instanceof Y.AbstractType ? holder.parent._item : null
  ) {
    if (holder.deleted) return null;
  }
  return { item, text };
}

/**
 * Where each character a text holds stands in it, deleted or not: its own characters and the
 * copies it holds, by identity, at the first place each one stands.
 */
function placesIn(text: Y.Text): Map<Identity, number> {
  const places = new Map<Identity, number>();
  let at = 0;
  for (let item = firstItem(text); item; item = item.right) {
    for (let offset = 0; offset < item.length; offset += 1, at += 1) {
      const identity = itemIdentity(text, item, offset);
      if (!places.has(identity)) places.set(identity, at);
    }
  }
  return places;
}

/**
 * The key of a paragraph in a source text: where the first character the paragraph holds a
 * moved copy of, deleted or not, stands in the source, or null when the source holds none
 * of its copies.
 */
function keyIn(text: Y.Text, places: ReadonlyMap<Identity, number>): number | null {
  const marks = marksOfText(text);
  for (let item = firstItem(text); item; item = item.right) {
    for (let offset = 0; offset < item.length; offset += 1) {
      if (!marks.origin('move', item.id.client, item.id.clock + offset)) continue;
      const at = places.get(itemIdentity(text, item, offset));
      if (at !== undefined) return at;
    }
  }
  return null;
}

export class CopyHolderOrder {
  /** Each source text's places, read again when the paragraph that holds it changes. */
  private readonly places = new Map<Y.Text, Map<Identity, number>>();
  /** Each paragraph's key in each source, for the places it was read against. */
  private readonly keys = new Map<
    LogicalId,
    Map<Y.Text, { readonly places: Map<Identity, number>; readonly key: number | null }>
  >();

  constructor(
    private readonly textOf: (paragraphId: LogicalId) => Y.Text | null,
    private readonly order: Order
  ) {}

  /**
   * The live texts that hold `length` characters of `client` from `from`, as consecutive
   * pieces: one author's consecutive characters can stand in several texts. A piece whose
   * characters stand in no live text, or have not arrived, has a null source.
   */
  sourceSegments(
    paragraphId: LogicalId,
    client: number,
    from: number,
    length: number
  ): { readonly start: number; readonly end: number; readonly source: Y.Text | null }[] {
    const doc = this.textOf(paragraphId)?.doc;
    const pieces: { start: number; end: number; source: Y.Text | null }[] = [];
    const end = from + length;
    for (let clock = from; clock < end; ) {
      let struct: Y.AbstractStruct | null = null;
      try {
        struct =
          doc && clock < Y.getState(doc.store, client)
            ? Y.getItem(doc.store, Y.createID(client, clock))
            : null;
      } catch {
        struct = null;
      }
      const next = struct ? Math.min(end, struct.id.clock + struct.length) : end;
      const source = struct && doc ? (placeOf(doc, `${client}:${clock}`)?.text ?? null) : null;
      const last = pieces.at(-1);
      if (last && last.source === source) last.end = next - from;
      else pieces.push({ start: clock - from, end: next - from, source });
      clock = Math.max(next, clock + 1);
    }
    return pieces;
  }

  /** The live text that holds a character, which `compare` reads keys in, or null. */
  sourceOf(paragraphId: LogicalId, identity: Identity): Y.Text | null {
    const doc = this.textOf(paragraphId)?.doc;
    return (doc && placeOf(doc, identity)?.text) ?? null;
  }

  /**
   * Negative when the copy in `a` of a character of `source` (`sourceOf`) gives way to the
   * copy in `b`, which then shows; positive the other way. Never zero for two paragraphs.
   */
  compare(a: LogicalId, b: LogicalId, source: Y.Text | null): number {
    if (a === b) return 0;
    if (source) {
      const first = this.keyOf(a, source);
      const second = this.keyOf(b, source);
      if (first !== second) {
        if (first === null) return -1;
        if (second === null) return 1;
        return first - second;
      }
    }
    return this.order(a, b);
  }

  /**
   * The paragraph of `paragraphs` whose copy of `identity` shows: for a moved copy by
   * `compare`, and for a copy an undo put back by document order alone.
   */
  lastOf(paragraphs: readonly LogicalId[], identity: Identity, moved: boolean): LogicalId | null {
    const source = moved && paragraphs.length > 1 ? this.sourceOf(paragraphs[0]!, identity) : null;
    let last: LogicalId | null = null;
    for (const id of paragraphs) {
      if (last === null || this.compare(id, last, source) > 0) last = id;
    }
    return last;
  }

  /** A paragraph's text or marks changed: read its keys, and its text as a source, again. */
  forget(paragraphId: LogicalId): void {
    this.keys.delete(paragraphId);
    const text = this.textOf(paragraphId);
    if (text) this.places.delete(text);
  }

  clear(): void {
    this.keys.clear();
    this.places.clear();
  }

  private keyOf(paragraphId: LogicalId, source: Y.Text): number | null {
    let places = this.places.get(source);
    if (!places) {
      if (this.places.size >= MAX_CACHED) this.places.clear();
      places = placesIn(source);
      this.places.set(source, places);
    }
    let keys = this.keys.get(paragraphId);
    const known = keys?.get(source);
    if (known && known.places === places) return known.key;
    const text = this.textOf(paragraphId);
    const key = text ? keyIn(text, places) : null;
    if (!keys) {
      if (this.keys.size >= MAX_CACHED) this.keys.clear();
      keys = new Map();
      this.keys.set(paragraphId, keys);
    }
    keys.set(source, { places, key });
    return key;
  }
}
