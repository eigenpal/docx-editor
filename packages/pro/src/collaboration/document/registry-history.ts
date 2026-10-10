/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * What the registry saw change that undo and the loose-member repair need to know.
 *
 * The session asks which records lost their last parent during one history step
 * (`history-undone.ts`), and the materializer asks which records an undo marked or a redo
 * unmarked since its last pass, because a record whose mark goes has to be given an edge
 * back again, and one that gets a mark has to lose the edge it was given.
 */
import type { LogicalId } from './identity.ts';

export class RegistryHistory {
  private readonly unlisted = new Set<LogicalId>();
  private readonly marks = new Set<LogicalId>();

  noteUnlisted(id: LogicalId): void {
    this.unlisted.add(id);
  }

  noteMarkChanged(id: LogicalId): void {
    this.marks.add(id);
  }

  /** The records that lost their last parent since the last call, and still have none. */
  takeUnlisted(isListed: (id: LogicalId) => boolean): LogicalId[] {
    const unlisted = [...this.unlisted].filter((id) => !isListed(id));
    this.unlisted.clear();
    return unlisted;
  }

  /** The records whose undo mark changed since the last call. */
  takeMarkChanges(): LogicalId[] {
    const changed = [...this.marks];
    this.marks.clear();
    return changed;
  }
}
