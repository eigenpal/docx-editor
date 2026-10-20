/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Children that two parents list at once, as one incremental pass meets them.
 *
 * A pass that claims subtree roots only cannot notice a second parent by placement, so it asks
 * the listings index instead: one lister means one parent, and more than one is the contest
 * that sends the whole rebuild back through a full pass to be resolved deterministically.
 *
 * Unless the decision is already made. When every contest a pass ran into is one the last
 * full pass decided, still resolves to the same parent, and the pass placed each contested
 * child under exactly that parent, the incremental result IS the full pass's answer. A peer
 * keeping one contest alive then costs its winner's rebuild, not the document, per keystroke.
 */
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import type { RepairIssue } from './schema.ts';

/** One issue per code and id: a rebuilt loser re-reports a duplicate the pass carried forward. */
export function dedupeIssues(issues: readonly RepairIssue[]): RepairIssue[] {
  const seen = new Set<string>();
  const kept: RepairIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}${issue.logicalId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(issue);
  }
  return kept;
}

export class ListingContests {
  /** Whether this pass placed a child that another parent also lists. */
  contested = false;
  /** False when this pass placed a contested child under a parent the registry does not resolve. */
  private matchesResolution = true;
  /** Contested ids the current pass ran into. Reset per pass. */
  private readonly encountered = new Set<LogicalId>();
  /**
   * What the last full pass decided for each contested id: the parent the registry resolved
   * then, `null` for none. Holds only ids that pass evidenced as contested, so a hostile peer
   * cannot grow it past the contests it actually keeps alive.
   */
  private lastResolution = new Map<LogicalId, LogicalId | null>();

  constructor(private readonly registry: DocumentRegistry) {}

  reset(): void {
    this.contested = false;
    this.encountered.clear();
    this.matchesResolution = true;
  }

  /** Note the listers of a child that `parentId` is about to place. */
  note(
    childId: LogicalId,
    parentId: LogicalId,
    placed: ReadonlySet<LogicalId>,
    partRoots: ReadonlySet<LogicalId>
  ): void {
    const registry = this.registry;
    // A lister no pass can reach places nothing, so it is no rival: a tombstone with no
    // survivor, or a node no parent lists that is not a part root, such as the run a split
    // mints and drops in one journal. Both still name the `w:rPr` their replacement owns,
    // and counting them sent every keystroke in text another replica split to a full pass.
    const listed = registry.listingParents(childId);
    // One lister is no contest; skip the per-lister reads the body root pays per block.
    const listers =
      listed.length <= 1
        ? listed
        : listed.filter((lister) =>
            registry.isTombstoned(lister)
              ? registry.replacedByOf(lister) !== null
              : partRoots.has(lister) || registry.listingParents(lister).length > 0
          );
    if (listers.length <= 1) return;
    this.contested = true;
    this.encountered.add(childId);
    // A tombstoned lister with a survivor routes the child through ADOPTION, which places it
    // somewhere `parentOf` does not model — the skip's oracle would approve a pass that
    // leaves the child in the survivor's reused subtree AND under the rebuilt live lister.
    // Adoption-involved contests always take the full pass. A survivor-less tombstone routes
    // no adoption, so it keeps the skip.
    if (
      listers.some(
        (lister) => registry.isTombstoned(lister) && registry.replacedByOf(lister) !== null
      )
    ) {
      this.matchesResolution = false;
    }
    // Placing the child here reproduces the full pass only when here is where the registry
    // resolves it. A child already placed was checked at its own placement.
    else if (!placed.has(childId) && registry.parentOf(childId) !== parentId) {
      this.matchesResolution = false;
    }
  }

  /** Whether the incremental pass already gives the answer the last full pass decided. */
  decided(): boolean {
    if (!this.matchesResolution) return false;
    for (const id of this.encountered) {
      const resolved = this.lastResolution.get(id);
      if (resolved === undefined || resolved !== this.registry.parentOf(id)) return false;
    }
    return true;
  }

  /** Remember what a full pass decided, for the contests it met and the duplicates it found. */
  record(duplicateParents: readonly LogicalId[]): void {
    const next = new Map<LogicalId, LogicalId | null>();
    for (const id of this.encountered) next.set(id, this.registry.parentOf(id));
    for (const id of duplicateParents) next.set(id, this.registry.parentOf(id));
    this.lastResolution = next;
  }
}
