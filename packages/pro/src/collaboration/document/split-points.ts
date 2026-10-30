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
 * The field is written once, by the peer that creates the paragraph, in the transaction that
 * creates it, so no two peers write it.
 */
import type * as Y from 'yjs';
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

/** A paragraph's split points, nearest last, or an empty list for none or a malformed value. */
export function splitPointsOf(record: Y.Map<unknown> | undefined): SplitPoint[] {
  const value = record?.get(NODE_SPLIT_POINTS_FIELD);
  if (typeof value !== 'string' || value.length > 4096) return [];
  const points: SplitPoint[] = [];
  for (const entry of value.split('\n').slice(-MAX_SPLIT_POINTS)) {
    const split = entry.lastIndexOf('@');
    const at = entry.slice(split + 1);
    if (split <= 0 || !SPLIT_AT.test(at)) return [];
    points.push({ source: entry.slice(0, split) as LogicalId, at });
  }
  return points;
}

function serialized(points: readonly SplitPoint[]): string {
  return points
    .slice(-MAX_SPLIT_POINTS)
    .map((point) => `${point.source}@${point.at}`)
    .join('\n');
}

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
  ids: readonly LogicalId[]
): void {
  if (!children) return;
  let listed: LogicalId[] | null = null;
  for (const id of ids) {
    const record = nodeOf(id);
    if (!record || !minted.has(record) || record.has(NODE_SPLIT_POINTS_FIELD)) continue;
    listed ??= children.toArray();
    const at = listed.indexOf(id);
    if (at <= 0) continue;
    const leftId = listed[at - 1]!;
    const last = lastOf(leftId);
    const inherited = splitPointsOf(nodeOf(leftId));
    const points = last ? [...inherited, { source: leftId, at: `${last}+` }] : inherited;
    if (points.length > 0) record.set(NODE_SPLIT_POINTS_FIELD, serialized(points));
  }
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
      if (write.record.has(NODE_SPLIT_POINTS_FIELD) && !minted.has(write.record)) break;
      minted.delete(write.record);
      write.record.set(
        NODE_SPLIT_POINTS_FIELD,
        serialized([...inherited, { source: source.id, at: origin }])
      );
      break;
    }
  }
}
