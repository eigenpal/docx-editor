/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';

export class MaterializeSplitProjection {
  private lastLosers: ReadonlySet<LogicalId> = new Set();
  private textOverlays: ReadonlyMap<LogicalId, string> = new Map();
  losers: ReadonlySet<LogicalId> = new Set();

  update(registry: DocumentRegistry): readonly LogicalId[] {
    const dirty: LogicalId[] = [];
    const nextLosers = registry.replacementLoserRuns();
    const addParent = (runId: LogicalId): void => {
      const parent = registry.parentOf(runId);
      if (parent !== null) dirty.push(parent);
    };
    for (const id of nextLosers) if (!this.lastLosers.has(id)) addParent(id);
    for (const id of this.lastLosers) if (!nextLosers.has(id)) addParent(id);
    this.lastLosers = nextLosers;
    this.losers = nextLosers;
    const overlays = registry.concurrentSplitTextOverlays();
    this.textOverlays = overlays.values;
    dirty.push(...overlays.changedIds);
    return dirty;
  }

  textValue(logicalId: LogicalId, fallback: string): string {
    return this.textOverlays.get(logicalId) ?? fallback;
  }
}
