/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Reading a run's text from the shared tree, for the concurrent-split dedup (#581).
 *
 * The dedup keeps one replica's split and drops another's ONLY when both spell the same text, so
 * it needs the text a set of runs carries, concatenated in document order. These reads live apart
 * from the registry so it stays under its line cap; they use only the registry's public reads.
 */

import { isElementRecord } from './schema.ts';
import type { DocumentRegistry } from './registry.ts';
import type { LogicalId } from './identity.ts';

/**
 * A run that still hangs off its parent, is not tombstoned, and exists.
 *
 * A multi-boundary split leaves an intermediate run detached from the paragraph but neither
 * tombstoned nor deleted; the dedup must not count its text, so it checks membership in the
 * parent's child array, not only the node map.
 */
export function runIsPresent(registry: DocumentRegistry, logicalId: LogicalId): boolean {
  if (!registry.hasNode(logicalId) || registry.isTombstoned(logicalId)) return false;
  const parent = registry.parentOf(logicalId);
  if (parent === null) return false;
  const rec = registry.record(parent);
  return rec !== null && isElementRecord(rec) && rec.childIds.includes(logicalId);
}

/**
 * The text a set of runs carries, concatenated in document order.
 *
 * The dedup compares this across replicas: a format split partitions the origin's text, so every
 * replica's products spell the same string, while a run a peer grew by typing does not.
 */
export function runGroupText(
  registry: DocumentRegistry,
  runIds: readonly LogicalId[],
  maxDepth: number
): string {
  const ordered = [...runIds].sort(
    (a, b) => siblingIndexOf(registry, a) - siblingIndexOf(registry, b)
  );
  let text = '';
  for (const id of ordered) text += runTextContent(registry, id, maxDepth, 0);
  return text;
}

function siblingIndexOf(registry: DocumentRegistry, logicalId: LogicalId): number {
  const parent = registry.parentOf(logicalId);
  if (parent === null) return 0;
  const rec = registry.record(parent);
  if (!rec || !isElementRecord(rec)) return 0;
  const index = rec.childIds.indexOf(logicalId);
  return index < 0 ? 0 : index;
}

function runTextContent(
  registry: DocumentRegistry,
  logicalId: LogicalId,
  maxDepth: number,
  depth: number
): string {
  if (depth > maxDepth) return '';
  const rec = registry.record(logicalId);
  if (!rec) return '';
  if (!isElementRecord(rec)) return rec.value;
  let text = '';
  for (const child of rec.childIds) text += runTextContent(registry, child, maxDepth, depth + 1);
  return text;
}
