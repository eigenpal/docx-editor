/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Narrow reads over one node record.
 *
 * `DocumentRegistry.record` builds a node's attribute and binding arrays and turns its
 * `Y.Text` into a string. A journal's bound checks and the tombstone's content test read
 * none of that, and both sit on the keystroke path now that a commit publishes its own
 * journal. Measuring a paragraph by building it costs the paragraph's length per touched
 * node, which makes typing cost what the document holds instead of what the edit changed.
 */

import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import {
  NODE_SHELL_FIELD,
  NODE_TEXT_FIELD,
  childArrayOf,
  isNodeMap,
  isTextNodeMap,
  unpackNodeShell,
} from './schema.ts';

/** What a bound check reads. Mutable, because the journal projection replays onto it. */
export interface NodeShape {
  isText: boolean;
  textLength: number;
  children: LogicalId[];
}

/** One node's class, text length and child ids. `children` is fresh, so callers may splice it. */
export function nodeShapeOf(nodes: Y.Map<Y.Map<unknown>>, logicalId: string): NodeShape | null {
  const rec = nodes.get(logicalId);
  // The nodes map is peer-writable; a scalar value is not a node.
  if (!isNodeMap(rec)) return null;
  if (isTextNodeMap(rec)) {
    // `Y.Text.length` is a counter. `toString()` builds the whole paragraph to measure it.
    const text = rec.get(NODE_TEXT_FIELD);
    return { isText: true, textLength: text instanceof Y.Text ? text.length : 0, children: [] };
  }
  return { isText: false, textLength: 0, children: childArrayOf(rec)?.toArray() ?? [] };
}

/** One node's kind, without building its text or its attribute arrays. */
export function nodeKindOf(nodes: Y.Map<Y.Map<unknown>>, logicalId: string): string | null {
  const rec = nodes.get(logicalId);
  if (!isNodeMap(rec)) return null;
  if (isTextNodeMap(rec)) return 'textValue';
  const shell = rec.get(NODE_SHELL_FIELD);
  return unpackNodeShell(typeof shell === 'string' ? shell : '').kind;
}

/** True when two child listings hold the same ids in the same order. */
export function sameChildOrder(left: readonly LogicalId[], right: readonly LogicalId[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
