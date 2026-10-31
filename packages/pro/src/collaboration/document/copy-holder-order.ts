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
 * each holder's key is the first character of that text it holds a moved copy of, deleted
 * or not: the copy whose key stands later in the text shows, as a later split point does.
 * A deleted copy keeps its identity and its mark, and a block move changes no text, so the
 * keys stay while peers edit and move the paragraphs. Document order decides between holders
 * with the same key. A holder with no key, as when its copy came from a text this replica
 * cannot place, gives way to one with a key. The comparison is one key per holder, so it
 * orders every holder of a character in one order and exactly one of them shows it.
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

/** How many answers of which of two characters comes first are kept. */
const MAX_ORDERS = 16_384;

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

/** The first copies of one paragraph, and what this replica still waits for to place them. */
interface FirstCopies {
  /** For each live text, the first character of it the paragraph holds a moved copy of. */
  readonly firsts: Map<Y.Text, Identity>;
  /** The clients whose copied characters have not arrived, and their state when read. */
  readonly waiting: Map<number, number>;
}

/**
 * For each text a paragraph's moved copies come from, the identity of the first character of
 * it the paragraph holds a copy of, deleted or not, in the paragraph's text order.
 */
function firstCopiesOf(text: Y.Text): FirstCopies {
  const firsts = new Map<Y.Text, Identity>();
  const waiting = new Map<number, number>();
  const doc = text.doc;
  if (!doc) return { firsts, waiting };
  const marks = marksOfText(text);
  for (let item = firstItem(text); item; item = item.right) {
    const end = item.id.clock + item.length;
    for (let clock = item.id.clock; clock < end; ) {
      const origin = marks.origin('move', item.id.client, clock);
      if (!origin) {
        clock += 1;
        continue;
      }
      // One insert copies consecutive characters: its first one here names their text.
      const identity = itemIdentity(text, item, clock - item.id.clock);
      const parsed = parseClientClock(identity);
      const state = parsed ? Y.getState(doc.store, parsed.client) : 0;
      if (parsed && parsed.clock >= state) waiting.set(parsed.client, state);
      const source = placeOf(doc, identity)?.text;
      if (source && !firsts.has(source)) firsts.set(source, identity);
      clock = Math.max(clock + 1, Math.min(end, origin.firstClock + origin.length));
    }
  }
  return { firsts, waiting };
}

/** Whether no client a read waited for has written since. */
function current(doc: Y.Doc, waiting: ReadonlyMap<number, number>): boolean {
  for (const [client, state] of waiting) if (Y.getState(doc.store, client) !== state) return false;
  return true;
}

export class CopyHolderOrder {
  /** The first copies of each paragraph read, by the text they come from. */
  private readonly firsts = new Map<LogicalId, FirstCopies>();
  /** Whether one character comes before another in their text. Item order never changes. */
  private readonly before = new Map<string, boolean>();

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
    const doc = source?.doc;
    if (doc && source) {
      const first = this.firstsOf(a).get(source) ?? null;
      const second = this.firstsOf(b).get(source) ?? null;
      if (first !== second) {
        if (first === null) return -1;
        if (second === null) return 1;
        return this.comesBefore(doc, first, second) ? -1 : 1;
      }
    }
    return this.order(a, b);
  }

  /** A paragraph's text or marks changed: read its copies again. */
  forget(paragraphId: LogicalId): void {
    this.firsts.delete(paragraphId);
  }

  clear(): void {
    this.firsts.clear();
  }

  private firstsOf(paragraphId: LogicalId): Map<Y.Text, Identity> {
    const text = this.textOf(paragraphId);
    const cached = this.firsts.get(paragraphId);
    // A copied character that arrives later can place a copy the last read could not.
    if (cached && text?.doc && current(text.doc, cached.waiting)) return cached.firsts;
    const read = text ? firstCopiesOf(text) : { firsts: new Map(), waiting: new Map() };
    if (this.firsts.size >= MAX_CACHED) this.firsts.clear();
    this.firsts.set(paragraphId, read);
    return read.firsts;
  }

  /** Whether `first` stands before `second` in the one live text that holds both. */
  private comesBefore(doc: Y.Doc, first: Identity, second: Identity): boolean {
    const key = `${first} ${second}`;
    const known = this.before.get(key);
    if (known !== undefined) return known;
    const left = placeOf(doc, first)?.item;
    const right = placeOf(doc, second)?.item;
    if (!left || !right) return first < second;
    let answer: boolean;
    if (left === right) answer = parseClientClock(first)!.clock < parseClientClock(second)!.clock;
    else {
      answer = false;
      for (let item = left.right; item; item = item.right) {
        if (item === right) {
          answer = true;
          break;
        }
      }
    }
    if (this.before.size >= MAX_ORDERS) this.before.clear();
    this.before.set(key, answer);
    return answer;
  }
}
