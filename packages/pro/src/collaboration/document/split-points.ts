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
 * offset in that paragraph's text where the moved text started. It keeps the split points of
 * the paragraph it split as well, so a paragraph split off a split paragraph still names the
 * split point of the paragraph it came from. Any other paragraph an edit creates, as a break at
 * a paragraph's end does, takes the split points of the paragraph listed right before it. The order reads these first, and reads the text
 * only when a paragraph holds none, as one a release without this field wrote.
 *
 * The field is written once, by the peer that creates the paragraph, in the transaction that
 * creates it, so no two peers write it.
 */
import type * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import { ORIGIN_KEY } from './paragraph-text-moves.ts';

/** The record field that holds a paragraph's split points. */
export const NODE_SPLIT_POINTS_FIELD = 'splitPoints';

/** How many split points a paragraph keeps: its own and those of its nearest ancestors. */
const MAX_SPLIT_POINTS = 4;

/** One split point: the paragraph split, and where in its text the moved text started. */
export interface SplitPoint {
  readonly source: LogicalId;
  readonly offset: number;
}

/** A paragraph's split points, nearest last, or an empty list for none or a malformed value. */
export function splitPointsOf(record: Y.Map<unknown> | undefined): SplitPoint[] {
  const value = record?.get(NODE_SPLIT_POINTS_FIELD);
  if (typeof value !== 'string' || value.length > 4096) return [];
  const points: SplitPoint[] = [];
  for (const entry of value.split('\n').slice(-MAX_SPLIT_POINTS)) {
    const at = entry.lastIndexOf('@');
    const offset = Number(entry.slice(at + 1));
    if (at <= 0 || !Number.isSafeInteger(offset) || offset < 0) return [];
    points.push({ source: entry.slice(0, at) as LogicalId, offset });
  }
  return points;
}

function serialized(points: readonly SplitPoint[]): string {
  return points
    .slice(-MAX_SPLIT_POINTS)
    .map((point) => `${point.source}@${point.offset}`)
    .join('\n');
}

/** Paragraph records the current edit created, by the peer that runs it. */
const minted = new WeakSet<Y.Map<unknown>>();

/** Note a paragraph record this edit created, before it is listed. */
export function noteMintedParagraph(record: Y.Map<unknown> | undefined): void {
  if (record) minted.add(record);
}

/**
 * Give each paragraph this edit created and just listed the split points of the paragraph
 * listed right before it.
 */
export function inheritSplitPoints(
  nodeOf: (id: LogicalId) => Y.Map<unknown> | undefined,
  children: Y.Array<LogicalId> | null,
  ids: readonly LogicalId[]
): void {
  if (!children) return;
  let listed: LogicalId[] | null = null;
  for (const id of ids) {
    const record = nodeOf(id);
    if (!record || !minted.has(record)) continue;
    minted.delete(record);
    if (record.has(NODE_SPLIT_POINTS_FIELD)) continue;
    listed ??= children.toArray();
    const at = listed.indexOf(id);
    const left = at > 0 ? nodeOf(listed[at - 1]!) : undefined;
    const points = splitPointsOf(left);
    if (points.length > 0) record.set(NODE_SPLIT_POINTS_FIELD, serialized(points));
  }
}

/** The offset a paragraph's split points give for a split of `source`, or null. */
export function splitOffsetIn(points: readonly SplitPoint[], source: LogicalId): number | null {
  for (let at = points.length - 1; at >= 0; at -= 1) {
    if (points[at]!.source === source) return points[at]!.offset;
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
    for (const source of writes) {
      if (source === write) continue;
      const offset = source.identities.indexOf(origin);
      if (offset < 0) continue;
      // Written once: a paragraph holds no field yet, or only what it took from the paragraph
      // it was listed after, which is the paragraph it was split off.
      const inherited = splitPointsOf(source.record);
      const held = write.record.get(NODE_SPLIT_POINTS_FIELD);
      if (held !== undefined && held !== serialized(inherited)) break;
      write.record.set(
        NODE_SPLIT_POINTS_FIELD,
        serialized([...inherited, { source: source.id, offset }])
      );
      break;
    }
  }
}
