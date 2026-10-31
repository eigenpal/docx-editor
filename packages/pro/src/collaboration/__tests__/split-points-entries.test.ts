/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Split points follow listing entries, not paragraph IDs: one splice can list several
// paragraphs in one entry item, and concurrent moves can list one block twice.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  handOnSplitPoints,
  inheritSplitPoints,
  NODE_SPLIT_POINTS_FIELD,
  splitPointsOf,
} from '../document/split-points.ts';
import type { LogicalId } from '../document/identity.ts';

function room(ids: readonly string[]) {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  const children = doc.getArray<LogicalId>('children');
  for (const id of ids) nodes.set(id, new Y.Map());
  return { doc, nodes, children, nodeOf: (id: LogicalId) => nodes.get(id) };
}

const items = (children: Y.Array<LogicalId>): Y.Item[] => {
  const out: Y.Item[] = [];
  for (let item = (children as unknown as { _start: Y.Item | null })._start; item; ) {
    if (!item.deleted) out.push(item);
    item = item.right;
  }
  return out;
};

test('a removed entry inside a multi-paragraph listing hands its split points on', () => {
  const r = room(['A', 'B', 'C']);
  r.children.insert(0, ['A', 'B'] as LogicalId[]);
  r.children.insert(2, ['C'] as LogicalId[]);
  const [listing] = items(r.children);
  r.nodeOf('B' as LogicalId)!.set(
    NODE_SPLIT_POINTS_FIELD,
    `#${listing!.id.client}:${listing!.id.clock + 1}\nsource@1:5`
  );
  handOnSplitPoints(r.nodeOf, r.children, 1, 1, (id) => id === 'B');
  expect(splitPointsOf(r.nodeOf('C' as LogicalId))).toEqual([
    { source: 'source' as LogicalId, at: '1:5' },
  ]);
});

test('a block listed twice takes the split points beside the entry this edit wrote', () => {
  const r = room(['L1', 'L2', 'X']);
  r.children.insert(0, ['L1', 'X', 'L2'] as LogicalId[]);
  r.nodeOf('L2' as LogicalId)!.set(NODE_SPLIT_POINTS_FIELD, '#9:9\nsource@1:7');
  r.nodeOf('L1' as LogicalId)!.set(NODE_SPLIT_POINTS_FIELD, '#9:8\nsource@1:3');
  r.children.insert(3, ['X'] as LogicalId[]);
  const written = items(r.children).at(-1)!;
  inheritSplitPoints(
    r.nodeOf,
    () => null,
    r.children,
    ['X' as LogicalId],
    [written],
    (id) => id === 'L2'
  );
  expect(splitPointsOf(r.nodeOf('X' as LogicalId))).toEqual([
    { source: 'source' as LogicalId, at: '1:7' },
  ]);
});
