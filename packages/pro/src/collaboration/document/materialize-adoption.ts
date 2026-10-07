/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { sameChildOrder } from './registry-node-reads.ts';

/** The join survivors' adoption sets the last materializer pass showed. */
export class AdoptionTracker {
  private lastAdoption = new Map<LogicalId, readonly LogicalId[]>();

  /**
   * Survivors whose derived adoption set moved since the last pass.
   *
   * A join tombstones one node with a replacement and the survivor grows the orphaned
   * children. Nothing about the survivor's own record changes, so no observer names it: the
   * only witness is this index. The node cache would hand the survivor back untouched and
   * the joined content would vanish, which is why the whole document used to rebuild
   * whenever membership moved. The index holds one entry per join survivor, so comparing it
   * costs nothing next to the walk it replaces.
   */
  changes(registry: DocumentRegistry): readonly LogicalId[] {
    const moved: LogicalId[] = [];
    const next = new Map<LogicalId, readonly LogicalId[]>();
    // A child a survivor stopped adopting shows under one of its other listers now. That
    // lister lost a contest to the survivor earlier and cached a build without the child, so
    // it rebuilds too. Without this an undone delete restored under a parent that a later
    // join removed showed on no replica that watched it happen, only on a cold read.
    const released = (before: readonly LogicalId[], after: readonly LogicalId[]): void => {
      const kept = new Set(after);
      for (const child of before) {
        if (kept.has(child)) continue;
        for (const lister of registry.listingParents(child)) {
          if (!registry.isTombstoned(lister)) moved.push(lister);
        }
      }
    };
    for (const [survivor, listed] of registry.adoptionIndex()) {
      // A survivor a later join removed shows nothing, whatever it still adopts.
      const adopted = registry.isTombstoned(survivor) ? [] : [...listed];
      next.set(survivor, adopted);
      const before = this.lastAdoption.get(survivor);
      if (before === undefined || !sameChildOrder(before, adopted)) {
        moved.push(survivor);
        if (before) released(before, adopted);
      }
    }
    for (const [survivor, before] of this.lastAdoption) {
      if (next.has(survivor)) continue;
      moved.push(survivor);
      released(before, []);
    }
    this.lastAdoption = next;
    return moved;
  }
}
