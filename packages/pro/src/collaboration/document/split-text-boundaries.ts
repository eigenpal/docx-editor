/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import {
  NODE_SPLIT_TEXT_SOURCE_FIELD,
  type SplitTextRange,
  type SplitTextSources,
} from './split-text-sources.ts';

/** Keep boundary insertions inside their selected slice, including deleted boundary anchors. */
export function captureInsertionBoundary(
  nodes: Y.Map<Y.Map<unknown>>,
  sources: SplitTextSources,
  targetId: string,
  range: SplitTextRange | null,
  offset: number,
  insert: string
): (() => void) | null {
  if (!range || insert.length === 0) return null;
  const atStart = offset === 0 && range.startAssoc !== -1;
  let atEnd = offset === range.end - range.start;
  if (!atStart && !atEnd) return null;
  const target = JSON.parse(nodes.get(targetId)!.get(NODE_SPLIT_TEXT_SOURCE_FIELD) as string);
  const startAnchor = Y.createRelativePositionFromJSON(target.start);
  const endAnchor = Y.createRelativePositionFromJSON(target.end);
  // A live following character (or the source tail sentinel) already moves an end
  // boundary past inserted text. Only deleted anchors need an explicit repair.
  atEnd =
    atEnd &&
    (atStart ||
      (endAnchor.item !== null && Y.getItem(range.text.doc!.store, endAnchor.item).deleted));
  if (!atStart && !atEnd) return null;
  const boundaries: {
    record: Y.Map<unknown>;
    start: 'before' | 'after' | null;
    end: 'before' | 'after' | null;
  }[] = [];
  for (const id of sources.sourceAliases(range.sourceId)) {
    // Validate all metadata before editing shared text.
    if (!sources.range(id)) continue;
    const record = nodes.get(id)!;
    const data = JSON.parse(record.get(NODE_SPLIT_TEXT_SOURCE_FIELD) as string);
    const side = (endpoint: unknown, edge: 'start' | 'end'): 'before' | 'after' | null => {
      const position = Y.createRelativePositionFromJSON(endpoint);
      if (
        atStart &&
        atEnd &&
        Y.compareRelativePositions(startAnchor, endAnchor) &&
        Y.compareRelativePositions(position, startAnchor)
      )
        return edge === 'start' ? 'after' : 'before';
      if (atStart && Y.compareRelativePositions(position, startAnchor)) return 'before';
      if (atEnd && Y.compareRelativePositions(position, endAnchor)) return 'after';
      return null;
    };
    const start = id === targetId && atStart ? 'before' : side(data.start, 'start');
    const end = id === targetId && atEnd ? 'after' : side(data.end, 'end');
    if (start || end) boundaries.push({ record, start, end });
  }
  return () => {
    const index = range.start + offset;
    const before = Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(
        range.text,
        index,
        index === 0 && range.startAssoc === -1 ? -1 : 0
      )
    );
    const after = Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(range.text, index + insert.length, 0)
    );
    for (const boundary of boundaries) {
      const data = JSON.parse(boundary.record.get(NODE_SPLIT_TEXT_SOURCE_FIELD) as string);
      if (boundary.start) data.start = boundary.start === 'before' ? before : after;
      if (boundary.end) data.end = boundary.end === 'before' ? before : after;
      const encoded = JSON.stringify(data);
      if (encoded !== boundary.record.get(NODE_SPLIT_TEXT_SOURCE_FIELD)) {
        boundary.record.set(NODE_SPLIT_TEXT_SOURCE_FIELD, encoded);
      }
    }
  };
}
