/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Which of two nodes comes first in document order, read from the placed parents.
 *
 * Only contested copies ask, so each answer walks both nodes up to their roots.
 */
import type { LogicalId } from './identity.ts';

export interface PlacementReads {
  readonly parentOf: (id: LogicalId) => LogicalId | undefined;
  readonly childrenOf: (id: LogicalId) => readonly LogicalId[] | undefined;
  readonly maxDepth: number;
}

/** The root a node hangs from, then its index in each parent from the root down. */
function pathOf(reads: PlacementReads, id: LogicalId): { root: LogicalId; indexes: number[] } {
  const indexes: number[] = [];
  let current = id;
  for (let depth = 0; depth < reads.maxDepth; depth += 1) {
    const parent = reads.parentOf(current);
    if (parent === undefined) break;
    indexes.push(reads.childrenOf(parent)?.indexOf(current) ?? -1);
    current = parent;
  }
  return { root: current, indexes: indexes.reverse() };
}

/**
 * Negative when `a` comes before `b`. Nodes under different roots, or not placed, compare by
 * ID, so every replica orders them alike.
 */
export function compareDocumentOrder(reads: PlacementReads, a: LogicalId, b: LogicalId): number {
  if (a === b) return 0;
  const left = pathOf(reads, a);
  const right = pathOf(reads, b);
  if (left.root === right.root) {
    const length = Math.min(left.indexes.length, right.indexes.length);
    for (let at = 0; at < length; at += 1) {
      const difference = left.indexes[at]! - right.indexes[at]!;
      if (difference !== 0) return difference;
    }
  }
  return a < b ? -1 : 1;
}
