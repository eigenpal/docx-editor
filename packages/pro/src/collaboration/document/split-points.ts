/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Where each split put its new paragraph, recorded on the new paragraph.
 *
 * Concurrent splits of one paragraph list their new paragraphs at one place, and
 * `split-sibling-order.ts` orders them by the text they copy. That text can stop telling the
 * order: a paragraph a run holds can be deleted, so its text cannot be read alike on every
 * replica, and a paragraph split off it later holds text from elsewhere. So each split also
 * records, on the paragraph it creates, the split point: the paragraph it split and the
 * identity of the first character it moved (`paragraph-text-identity.ts`). An identity names
 * one character on every replica, whatever text each peer typed or deleted before it, so the
 * order compares where those characters stand in the text they came from, not offsets that
 * each peer counted in its own view. It keeps the split points of
 * the paragraph it split as well, so a paragraph split off a split paragraph still names the
 * split point of the paragraph it came from. Any other paragraph an edit creates, as a break at
 * a paragraph's end does, counts as split off the end of the paragraph listed right before
 * it. The order reads these first, and reads the text
 * only when a paragraph holds none, as one a release without this field wrote.
 *
 * The value starts with the listing entry it was written for (`#client:clock`): the order
 * counts a paragraph as a split only at that entry, so a block that a move, an undo, or a redo
 * lists again keeps its points but takes no part where it now stands. The edit that lists the
 * paragraph writes the field, in the transaction that lists it: the split that creates it, a
 * move that puts a block right after a sibling the order moves, or the deletion of such a
 * sibling's entry, which hands its points to the block listed after it.
 */
import * as Y from 'yjs';
import { firstItem } from './yjs-items.ts';
import { itemIdentity } from './paragraph-text-identity.ts';
import type { LogicalId } from './identity.ts';
import { ORIGIN_KEY } from './paragraph-text-moves.ts';

/** The record field that holds a paragraph's split points. */
export const NODE_SPLIT_POINTS_FIELD = 'splitPoints';

/** How many split points a paragraph keeps: its own and those of its nearest ancestors. */
const MAX_SPLIT_POINTS = 4;

/**
 * One split point: the paragraph split, and the identity of the first character moved, or of
 * the last character kept with a `+` after it for a split at the end of the paragraph.
 */
export interface SplitPoint {
  readonly source: LogicalId;
  readonly at: string;
}

const IDENTITY = /^\d{1,16}:\d{1,16}$/;
const SPLIT_AT = /^\d{1,16}:\d{1,16}\+?$/;

/** The last character of a paragraph text that is still there, by identity, or null. */
export function lastIdentityOf(text: Y.Text | null): string | null {
  if (!text) return null;
  let last: Y.Item | null = null;
  for (let item = firstItem(text); item; item = item.right) {
    if (!item.deleted && typeof (item.content as { str?: unknown }).str === 'string') last = item;
  }
  return last ? itemIdentity(text, last, last.length - 1) : null;
}

/** The lines of a paragraph's split points field, or null for none or a malformed value. */
function fieldLines(record: Y.Map<unknown> | undefined): string[] | null {
  const value = record?.get(NODE_SPLIT_POINTS_FIELD);
  return typeof value === 'string' && value.length <= 4096 ? value.split('\n') : null;
}

/** The listing entry a paragraph's split points were written for, or null. */
export function splitEntryOf(record: Y.Map<unknown> | undefined): Y.ID | null {
  const first = fieldLines(record)?.[0];
  const match = first ? /^#(\d{1,16}):(\d{1,16})$/.exec(first) : null;
  return match ? Y.createID(Number(match[1]), Number(match[2])) : null;
}

/** A paragraph's split points, nearest last, or an empty list for none or a malformed value. */
export function splitPointsOf(record: Y.Map<unknown> | undefined): SplitPoint[] {
  const lines = fieldLines(record);
  if (!lines) return [];
  const points: SplitPoint[] = [];
  for (const entry of lines.filter((line) => !line.startsWith('#')).slice(-MAX_SPLIT_POINTS)) {
    const split = entry.lastIndexOf('@');
    const at = entry.slice(split + 1);
    if (split <= 0 || !SPLIT_AT.test(at)) return [];
    points.push({ source: entry.slice(0, split) as LogicalId, at });
  }
  return points;
}

function serialized(points: readonly SplitPoint[], entry: string): string {
  return [
    `#${entry}`,
    ...points.slice(-MAX_SPLIT_POINTS).map((point) => `${point.source}@${point.at}`),
  ].join('\n');
}

/** The listing entry this edit gave each record it listed, for the fields it writes later. */
const entries = new WeakMap<Y.Map<unknown>, string>();

const entryKey = (item: Y.Item, id: LogicalId): string | null => {
  const at = (item.content.getContent() as unknown[]).indexOf(id);
  return at < 0 ? null : `${item.id.client}:${item.id.clock + at}`;
};

/**
 * Paragraph records the current edit created, by the peer that runs it. Only that edit writes
 * their split points: `endSplitPointEdit` forgets them when it ends, so a later edit of the
 * paragraph, as text pasted into a paragraph a break left empty, never rewrites the field.
 */
let minted = new WeakSet<Y.Map<unknown>>();

/** Note a paragraph record this edit created, before it is listed. */
export function noteMintedParagraph(record: Y.Map<unknown> | undefined): void {
  if (record) minted.add(record);
}

/** The edit that noted new paragraphs ended: their split points are final. */
export function endSplitPointEdit(): void {
  minted = new WeakSet();
}

/**
 * Give each paragraph this edit created and just listed the split points of the paragraph
 * listed right before it, plus a split at that paragraph's end. A split that moves text into
 * the paragraph names its own split point afterwards (`recordSplitPoints`).
 */
export function inheritSplitPoints(
  nodeOf: (id: LogicalId) => Y.Map<unknown> | undefined,
  lastOf: (id: LogicalId) => string | null,
  children: Y.Array<LogicalId> | null,
  ids: readonly LogicalId[],
  /** The items this edit wrote into `children`. */
  written: readonly Y.Item[],
  /**
   * Whether a listed child is a concurrent split sibling the rule moves. A block this edit
   * moves right after one takes its split points too: it follows that sibling, and once the
   * sibling is deleted, whose entry then names no paragraph, its points still place the block.
   */
  reordered: (id: LogicalId) => boolean = () => false
): void {
  if (!children) return;
  let listed: LogicalId[] | null = null;
  for (const id of ids) {
    const record = nodeOf(id);
    if (!record) continue;
    let entry: string | null = null;
    for (const item of written) if (!item.deleted && (entry = entryKey(item, id))) break;
    if (!entry) continue;
    const created = minted.has(record);
    if (created) entries.set(record, entry);
    if (created && record.has(NODE_SPLIT_POINTS_FIELD)) continue;
    listed ??= children.toArray();
    const at = listed.indexOf(id);
    const leftId = at > 0 ? listed[at - 1]! : undefined;
    if (!created && (leftId === undefined || !reordered(leftId))) continue;
    const inherited = splitPointsOf(leftId === undefined ? undefined : nodeOf(leftId));
    // A paragraph this edit created also counts as split off the end of the one before it.
    const last = created && leftId !== undefined ? lastOf(leftId) : null;
    const points = last ? [...inherited, { source: leftId!, at: `${last}+` }] : inherited;
    if (points.length > 0) record.set(NODE_SPLIT_POINTS_FIELD, serialized(points, entry));
  }
}

/**
 * Before this edit removes listing entries from `children`: a removed entry of a sibling the
 * order moves hands its split points to the entry listed right after it from its own place,
 * which then shows where the sibling showed. A collected entry names no paragraph, so without
 * this the block would lose its place in the run.
 */
export function handOnSplitPoints(
  nodeOf: (id: LogicalId) => Y.Map<unknown> | undefined,
  children: Y.Array<LogicalId> | null,
  start: number,
  count: number,
  reordered: (id: LogicalId) => boolean
): void {
  if (!children || count <= 0) return;
  const removed: Y.Item[] = [];
  let index = 0;
  let item = (children as unknown as { _start: Y.Item | null })._start;
  for (; item && index < start + count; item = item.right) {
    if (item.deleted || !item.countable) continue;
    if (index >= start) removed.push(item);
    index += item.length;
  }
  for (const gone of removed) {
    const id = (gone.content.getContent() as LogicalId[])[0]!;
    if (!reordered(id)) continue;
    const points = splitPointsOf(nodeOf(id));
    if (points.length === 0) continue;
    // The first entry that stays among those listed after it from its place, through entries
    // this edit removes as well, as a block moved with it.
    const chain = [gone];
    let next = gone.right;
    for (; next; next = next.right) {
      if (next.deleted && !chain.some((member) => inItem(next!.origin, member))) continue;
      if (!chain.some((member) => inItem(next!.origin, member))) {
        next = null;
        break;
      }
      if (!next.deleted && !removed.includes(next)) break;
      chain.push(next);
    }
    if (!next) continue;
    const nextId = (next.content.getContent() as LogicalId[])[0]!;
    const record = nodeOf(nextId);
    const entry = record ? entryKey(next, nextId) : null;
    if (!record || !entry) continue;
    // A paragraph split off a block that followed the sibling keeps its own split points
    // after the sibling's, as it would hold had it been split off the sibling's piece.
    const own = splitEntryOf(record);
    const held = own && inItem(own, next) ? splitPointsOf(record) : [];
    if (held.some((point) => point.source === points.at(-1)!.source)) continue;
    record.set(NODE_SPLIT_POINTS_FIELD, serialized([...points, ...held], entry));
  }
}

/** Whether `id` names an element of `item`. */
export function inItem(id: Y.ID | null, item: Y.Item): boolean {
  return (
    id !== null &&
    id.client === item.id.client &&
    id.clock >= item.id.clock &&
    id.clock < item.id.clock + item.length
  );
}

/** The first moved character a paragraph's split points give for a split of `source`. */
export function splitAtIn(points: readonly SplitPoint[], source: LogicalId): string | null {
  for (let at = points.length - 1; at >= 0; at -= 1) {
    if (points[at]!.source === source) return points[at]!.at;
  }
  return null;
}

interface SplitWrite {
  readonly id: LogicalId;
  readonly record: Y.Map<unknown>;
  readonly before: readonly unknown[];
  readonly after: readonly { readonly attributes: Readonly<Record<string, string>> }[];
  readonly identities: readonly (string | null)[];
}

/**
 * Record the split point on each paragraph this edit creates whose text starts with text it
 * moved from another paragraph of the edit.
 */
export function recordSplitPoints(writes: readonly SplitWrite[]): void {
  for (const write of writes) {
    if (write.before.length > 0) continue;
    const origin = write.after.find((token) => token.attributes[ORIGIN_KEY])?.attributes[
      ORIGIN_KEY
    ];
    if (!origin) continue;
    if (!IDENTITY.test(origin)) continue;
    for (const source of writes) {
      if (source === write) continue;
      if (!source.identities.includes(origin)) continue;
      // Written by the edit that creates the paragraph, over what the listing gave it.
      const inherited = splitPointsOf(source.record);
      const entry = entries.get(write.record);
      if (!entry) break;
      // Only the edit that created the paragraph writes them: a later join into it does not.
      if (!minted.has(write.record)) break;
      minted.delete(write.record);
      write.record.set(
        NODE_SPLIT_POINTS_FIELD,
        serialized([...inherited, { source: source.id, at: origin }], entry)
      );
      break;
    }
  }
}
