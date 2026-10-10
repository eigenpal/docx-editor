/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';

export class MaterializeSplitProjection {
  private textOverlays: ReadonlyMap<LogicalId, string> = new Map();
  losers: ReadonlySet<LogicalId> = new Set();
  /** Split texts waiting for their source, shown as nothing until it arrives. */
  awaiting: ReadonlySet<LogicalId> = new Set();

  update(registry: DocumentRegistry): readonly LogicalId[] {
    const dirty: LogicalId[] = [];
    const nextLosers = registry.replacementLoserRuns();
    // The run itself is dirty too: the parent index can have lost a run a peer detached, and
    // the materializer climbs to where the run was SHOWN, which is what has to rebuild.
    const addParent = (runId: LogicalId): void => {
      dirty.push(runId);
      const parent = registry.parentOf(runId);
      if (parent !== null) dirty.push(parent);
    };
    for (const id of nextLosers) if (!this.losers.has(id)) addParent(id);
    for (const id of this.losers) if (!nextLosers.has(id)) addParent(id);
    this.losers = nextLosers;
    const overlays = registry.concurrentSplitTextOverlays();
    this.textOverlays = overlays.values;
    this.awaiting = overlays.awaiting;
    dirty.push(...overlays.changedIds);
    return dirty;
  }

  textValue(logicalId: LogicalId, fallback: string): string {
    return this.textOverlays.get(logicalId) ?? fallback;
  }
}
