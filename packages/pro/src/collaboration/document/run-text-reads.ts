/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Reading a run's placement in the shared tree, for the concurrent-split dedup (#581).
 *
 * This read lives apart from the registry so it stays under its line cap; it uses only the
 * registry's public reads.
 */

import { isElementRecord } from './schema.ts';
import type { DocumentRegistry } from './registry.ts';
import type { LogicalId } from './identity.ts';

/**
 * A run that still hangs off its parent, is not tombstoned, and exists.
 *
 * A multi-boundary split leaves an intermediate run detached from the paragraph but neither
 * tombstoned nor deleted; the dedup must not count it, so it checks membership in the parent's
 * child array, not only the node map.
 */
export function runIsPresent(registry: DocumentRegistry, logicalId: LogicalId): boolean {
  if (!registry.hasNode(logicalId) || registry.isTombstoned(logicalId)) return false;
  const parent = registry.parentOf(logicalId);
  if (parent === null) return false;
  const rec = registry.record(parent);
  return rec !== null && isElementRecord(rec) && rec.childIds.includes(logicalId);
}
