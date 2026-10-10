/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Report nodes that no part can reach.
 *
 * Reachability is read off the listings index rather than off a placement set built by
 * walking, because filling that set was the whole cost of a received keystroke: every
 * block the edit did not touch got visited to record that it is still where it was. A node
 * that any live parent lists is in the tree, and a part root is reachable by definition.
 *
 * This reports the ROOT of a detached subtree rather than every node inside it — the nodes
 * beneath it still have a parent, it just is not connected to a part. That is the more
 * useful signal anyway: one issue names the break instead of one per node below it.
 */

import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import {
  isElementRecord,
  isTextRecord,
  nodeRecordUndone,
  type ElementRecord,
  type RepairIssueCode,
} from './schema.ts';
import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';

type Push = (code: RepairIssueCode, logicalId?: LogicalId) => void;

/**
 * Whether some parent's CURRENT child array still names this id.
 *
 * The listings index answers "who has ever listed it", which is not the same question: a
 * parent whose whole record was replaced can leave a listing behind for a child it no
 * longer has. Reading the arrays back makes the answer authoritative, and the callers only
 * ask it about ids this pass watched leave a parent, so the read is bounded by the edit.
 *
 * A tombstoned parent counts. Its children are adopted by the survivor rather than lost, so
 * they have a place in the tree and must not be adopted into a part on top of it. A parent no
 * pass can reach does not: a part root that lost its directory entry to a concurrent one, and
 * that nothing lists, places nothing, so a full pass adopts its members and so must this one.
 */
function stillListed(registry: DocumentRegistry, logicalId: LogicalId): boolean {
  let roots: ReadonlySet<LogicalId> | null = null;
  for (const parent of registry.listingParents(logicalId)) {
    const record = registry.record(parent);
    if (!record || !isElementRecord(record) || !record.childIds.includes(logicalId)) continue;
    if (registry.isTombstoned(parent) || registry.listingParents(parent).length > 0) return true;
    roots ??= new Set(registry.partEntries().map((entry) => entry.rootLogicalId));
    if (roots.has(parent)) return true;
  }
  return false;
}

/** Name a node no part reaches, saying whether anything a reader could see went with it. */
function pushOrphan(registry: DocumentRegistry, push: Push, logicalId: LogicalId): void {
  const record = registry.record(logicalId);
  const hasContent =
    !!record &&
    (isTextRecord(record)
      ? record.value.length > 0
      : record.childIds.length > 0 || record.attributes.length > 0);
  push(hasContent ? 'orphan-with-content' : 'orphan', logicalId);
}

export function reportOrphans(
  registry: DocumentRegistry,
  push: Push,
  candidates: Iterable<LogicalId>,
  placed: ReadonlySet<LogicalId>,
  incremental: boolean,
  loose: Set<LogicalId>
): void {
  if (!incremental) {
    for (const id of candidates) {
      if (registry.isTombstoned(id) || placed.has(id)) continue;
      pushOrphan(registry, push, id);
      loose.add(id);
    }
    return;
  }
  const partRoots = new Set(registry.partEntries().map((entry) => entry.rootLogicalId));
  const scanned = new Set<LogicalId>();
  for (const root of candidates) {
    if (scanned.has(root)) continue;
    scanned.add(root);
    if (reportOrphansUnder(registry, push, root, placed, partRoots)) loose.add(root);
  }
}

/**
 * Report everything unreachable at or under `root`, and say whether anything was.
 *
 * A tombstone is a deliberate delete, so it is not itself a loss — but its CHILDREN can be.
 * Deleting a paragraph while a peer types inside it leaves that text referenced by nothing,
 * which is the one shape of silent loss this walk exists to name. A full pass finds it by
 * scanning every id; descending from the tombstone instead keeps the work proportional to
 * the subtree the edit removed.
 */
function reportOrphansUnder(
  registry: DocumentRegistry,
  push: Push,
  root: LogicalId,
  placed: ReadonlySet<LogicalId>,
  partRoots: ReadonlySet<LogicalId>
): boolean {
  let reported = false;
  const seen = new Set<LogicalId>();
  const stack = [{ id: root, underTombstone: false }];
  while (stack.length > 0) {
    const { id, underTombstone } = stack.pop()!;
    if (seen.has(id) || seen.size >= registry.limits.maxTreeDepth) continue;
    seen.add(id);
    if (registry.isTombstoned(id)) {
      const record = registry.record(id);
      if (record && isElementRecord(record)) {
        for (const child of record.childIds) stack.push({ id: child, underTombstone: true });
      }
      continue;
    }
    if (partRoots.has(id)) continue;
    // Beneath a tombstone the listings index cannot answer reachability: the dead parent
    // still names the child, and `stillListed` counts that deliberately, because the
    // registry re-homes an adopted child onto the survivor. Placement is the authority
    // there — an adopter has to rebuild to take the child, so this pass placed it.
    if (underTombstone ? placed.has(id) : stillListed(registry, id)) continue;
    pushOrphan(registry, push, id);
    reported = true;
  }
  return reported;
}

/**
 * Find members of this part that no live parent lists, and give them an edge back.
 *
 * `candidates` is the whole node table only on a full pass. On an incremental one it is the
 * ids that left a child array during this very pass, which is the only way a member can
 * lose its last parent — and it is why receiving a character in a document that happens to
 * have a comments part no longer reads every node key once per adoptable part.
 */
export function adoptLooseMembers(
  registry: DocumentRegistry,
  materialize: (id: LogicalId) => OoxmlNode | null,
  members: OoxmlElement[],
  seen: Set<LogicalId>,
  isMember: (record: ElementRecord) => boolean,
  placed: Set<LogicalId>,
  incremental: boolean,
  candidates: Iterable<LogicalId>,
  loose: Set<LogicalId>
): number {
  let adopted = 0;
  for (const id of candidates) {
    if (placed.has(id) || seen.has(id) || registry.isTombstoned(id)) continue;
    // An undo took it out of its part; only a concurrent loss gets an edge back.
    if (nodeRecordUndone(registry.schema.nodes.get(id))) continue;
    // `placed` is complete only on a full pass. On an incremental one a surviving parent may
    // sit inside a subtree claimed by its root alone, so reachability has to be established
    // another way — otherwise a child that merely MOVED would be adopted into the part as a
    // second copy.
    if (incremental && stillListed(registry, id)) continue;
    const record = registry.record(id);
    if (!record || !isElementRecord(record) || !isMember(record)) continue;
    const node = materialize(id);
    if (!node || node.kind === 'textValue') continue;
    members.push(node);
    seen.add(id);
    // The adoption itself is not written anywhere, so the next pass has to find this member
    // again or it drops back out of the part it was just rescued into.
    loose.add(id);
    adopted += 1;
  }
  return adopted;
}
