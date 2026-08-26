/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  CanonicalNodeDescriptor,
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
} from '@docx-editor.dev/core/collaboration';
import type { LogicalId } from './identity.ts';
import {
  rejectBlobDescriptor,
  rejectDangerousKey,
  rejectPartName,
  rejectString,
  type LimitCode,
} from './limits.ts';
import { JOURNAL_ORIGIN } from './schema.ts';
import { JournalProjection, projectEffect } from './journal-projection.ts';
import type { DocumentRegistry } from './registry.ts';

export type JournalRefusalCode =
  | LimitCode
  | 'unknown-logical-id'
  | 'invalid-bound'
  | 'partial-apply-forbidden';

export type ApplyJournalResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: JournalRefusalCode; readonly detail?: string };

function requireKnown(projection: JournalProjection, id: string): ApplyJournalResult | null {
  if (rejectDangerousKey(id) || id.length === 0) {
    return { ok: false, code: 'prototype-key', detail: id };
  }
  if (!projection.has(id)) return { ok: false, code: 'unknown-logical-id', detail: id };
  return null;
}

function validateDescriptor(
  registry: DocumentRegistry,
  descriptor: CanonicalNodeDescriptor,
  projection: JournalProjection
): ApplyJournalResult | null {
  if (rejectDangerousKey(descriptor.logicalId) || descriptor.logicalId.length === 0) {
    return { ok: false, code: 'invalid-logical-id', detail: descriptor.logicalId };
  }
  // A `putNode` for a known id renames one element in place — a note conversion keeps the
  // node and its children. Only a change of node CLASS is incoherent, because an element and
  // a text value hold different state.
  const existing = projection.node(descriptor.logicalId);
  if (existing && existing.isText !== (descriptor.kind === 'textValue')) {
    return { ok: false, code: 'invalid-bound', detail: `node class ${descriptor.logicalId}` };
  }
  if (descriptor.kind === 'textValue') return null;
  if (rejectDangerousKey(descriptor.qname.localName)) {
    return { ok: false, code: 'prototype-key', detail: descriptor.qname.localName };
  }
  return rejectString(descriptor.qname.namespaceUri, registry.limits.maxStringLength)
    ? { ok: false, code: 'invalid-string' }
    : null;
}

function validateEffect(
  registry: DocumentRegistry,
  effect: CanonicalPrimitiveEffect,
  projection: JournalProjection
): ApplyJournalResult | null {
  switch (effect.kind) {
    case 'putNode':
      return validateDescriptor(registry, effect.descriptor, projection);
    case 'spliceText': {
      const missing = requireKnown(projection, effect.logicalId);
      if (missing) return missing;
      if (
        !Number.isSafeInteger(effect.utf16Start) ||
        !Number.isSafeInteger(effect.deleteCount) ||
        effect.utf16Start < 0 ||
        effect.deleteCount < 0
      ) {
        return { ok: false, code: 'invalid-bound' };
      }
      if (effect.insert.length > registry.limits.maxTextLength) {
        return { ok: false, code: 'text-too-long' };
      }
      const node = projection.node(effect.logicalId);
      if (node && node.isText) {
        if (effect.utf16Start + effect.deleteCount > node.textLength) {
          return { ok: false, code: 'invalid-bound', detail: effect.logicalId };
        }
        if (
          node.textLength - effect.deleteCount + effect.insert.length >
          registry.limits.maxTextLength
        ) {
          return { ok: false, code: 'text-too-long' };
        }
      } else if (node) {
        return { ok: false, code: 'invalid-bound', detail: effect.logicalId };
      }
      return null;
    }
    case 'setAttribute': {
      const missing = requireKnown(projection, effect.logicalId);
      if (missing) return missing;
      if (rejectDangerousKey(effect.qname.localName)) {
        return { ok: false, code: 'prototype-key', detail: effect.qname.localName };
      }
      if (rejectString(effect.qname.namespaceUri, registry.limits.maxStringLength)) {
        return { ok: false, code: 'invalid-string' };
      }
      if (effect.value !== null && effect.value.length > registry.limits.maxStringLength) {
        return { ok: false, code: 'invalid-string' };
      }
      return null;
    }
    case 'setNamespaceBinding': {
      const missing = requireKnown(projection, effect.logicalId);
      if (missing) return missing;
      if (rejectDangerousKey(effect.prefix)) return { ok: false, code: 'prototype-key' };
      if (effect.uri !== null && rejectString(effect.uri, registry.limits.maxStringLength)) {
        return { ok: false, code: 'invalid-string' };
      }
      return null;
    }
    case 'spliceChildren': {
      const missing = requireKnown(projection, effect.parentLogicalId);
      if (missing) return missing;
      if (
        !Number.isSafeInteger(effect.start) ||
        !Number.isSafeInteger(effect.deleteCount) ||
        effect.start < 0 ||
        effect.deleteCount < 0
      ) {
        return { ok: false, code: 'invalid-bound' };
      }
      if (effect.childLogicalIds.length > registry.limits.maxChildren) {
        return { ok: false, code: 'too-many-children' };
      }
      for (const childId of effect.childLogicalIds) {
        const childMissing = requireKnown(projection, childId);
        if (childMissing) return childMissing;
      }
      const parent = projection.node(effect.parentLogicalId);
      if (parent && !parent.isText) {
        if (effect.start + effect.deleteCount > parent.children.length) {
          return { ok: false, code: 'invalid-bound', detail: effect.parentLogicalId };
        }
        if (
          parent.children.length - effect.deleteCount + effect.childLogicalIds.length >
          registry.limits.maxChildren
        ) {
          return { ok: false, code: 'too-many-children' };
        }
      } else if (parent) {
        return { ok: false, code: 'invalid-bound', detail: effect.parentLogicalId };
      }
      return null;
    }
    case 'moveNode': {
      const missing = requireKnown(projection, effect.logicalId);
      if (missing) return missing;
      const dest = requireKnown(projection, effect.destinationParentLogicalId);
      if (dest) return dest;
      if (!Number.isSafeInteger(effect.destinationIndex) || effect.destinationIndex < 0) {
        return { ok: false, code: 'invalid-bound' };
      }
      return null;
    }
    case 'putXmlPart': {
      const partError = rejectPartName(effect.name);
      if (partError) return { ok: false, code: partError, detail: effect.name };
      const missing = requireKnown(projection, effect.rootLogicalId);
      if (missing) return missing;
      if (registry.partEntries().length >= registry.limits.maxParts) {
        return { ok: false, code: 'too-many-parts' };
      }
      return null;
    }
    case 'deleteXmlPart': {
      const partError = rejectPartName(effect.name);
      return partError ? { ok: false, code: partError, detail: effect.name } : null;
    }
    case 'putRelationship': {
      if (effect.record.ownerPart !== '/') {
        const ownerError = rejectPartName(effect.owner);
        if (ownerError) return { ok: false, code: ownerError };
      }
      if (rejectDangerousKey(effect.record.id)) return { ok: false, code: 'prototype-key' };
      if (registry.relationships().length >= registry.limits.maxRelationships) {
        return { ok: false, code: 'too-many-relationships' };
      }
      return null;
    }
    case 'deleteRelationship':
      if (rejectDangerousKey(effect.relationshipId)) return { ok: false, code: 'prototype-key' };
      return null;
    case 'putContentTypeOverride': {
      const partError = rejectPartName(effect.partName);
      if (partError) return { ok: false, code: partError };
      return rejectString(effect.mediaType, registry.limits.maxMediaTypeLength)
        ? { ok: false, code: 'invalid-string' }
        : null;
    }
    case 'deleteContentTypeOverride': {
      const partError = rejectPartName(effect.partName);
      return partError ? { ok: false, code: partError } : null;
    }
    case 'putBinary': {
      const blobError = rejectBlobDescriptor(effect.descriptor);
      return blobError ? { ok: false, code: blobError } : null;
    }
    case 'deleteBinary':
      if (rejectDangerousKey(effect.storageKey)) return { ok: false, code: 'prototype-key' };
      return null;
    default:
      return { ok: false, code: 'invalid-bound' };
  }
}

function applyEffect(
  registry: DocumentRegistry,
  effect: CanonicalPrimitiveEffect,
  initialText: ReadonlySet<string>
): void {
  switch (effect.kind) {
    case 'putNode':
      if (effect.descriptor.kind === 'textValue') {
        if (!registry.hasNode(effect.descriptor.logicalId)) {
          registry.putText(effect.descriptor.logicalId, '');
        }
      } else if (registry.hasNode(effect.descriptor.logicalId)) {
        registry.updateElementShell(effect.descriptor.logicalId, {
          kind: effect.descriptor.kind,
          namespaceUri: effect.descriptor.qname.namespaceUri,
          localName: effect.descriptor.qname.localName,
          prefix: effect.descriptor.qname.prefix,
        });
      } else {
        registry.putElement({
          logicalId: effect.descriptor.logicalId,
          kind: effect.descriptor.kind,
          namespaceUri: effect.descriptor.qname.namespaceUri,
          localName: effect.descriptor.qname.localName,
          prefix: effect.descriptor.qname.prefix,
          attributes: [],
          bindings: [],
        });
      }
      return;
    case 'spliceText':
      // `putNode` mints an empty text shell and the matching `spliceText(0, 0, value)` is that
      // node's initial content. Inserting it again on a second apply of the same journal
      // duplicates the text in place: a run split becomes `Date: Date: …March 2 2026March 2
      // 2026`. A minted node already holding exactly this value has had its fill applied, so
      // the effect is satisfied and repeating it is the bug.
      //
      // Only equality is safe to skip. Any other current value means the `putNode` was a shell
      // update on a node that already carries text, which is how a qname change replicates —
      // there the splice really is an insert, and the fall-through below performs it.
      if (
        initialText.has(effect.logicalId) &&
        effect.utf16Start === 0 &&
        effect.deleteCount === 0 &&
        registry.textOf(effect.logicalId).toString() === effect.insert
      ) {
        return;
      }
      registry.spliceText(effect.logicalId, effect.utf16Start, effect.deleteCount, effect.insert);
      return;
    case 'setAttribute':
      registry.setAttribute(effect.logicalId, effect.qname, effect.value);
      return;
    case 'setNamespaceBinding':
      registry.setNamespaceBinding(effect.logicalId, effect.prefix, effect.uri);
      return;
    case 'spliceChildren':
      registry.spliceChildren(
        effect.parentLogicalId,
        effect.start,
        effect.deleteCount,
        effect.childLogicalIds
      );
      return;
    case 'moveNode':
      registry.moveNode(
        effect.logicalId,
        effect.destinationParentLogicalId,
        effect.destinationIndex
      );
      return;
    case 'putXmlPart':
      registry.putXmlPart({
        name: effect.name,
        id: effect.name,
        rootLogicalId: effect.rootLogicalId,
        contentType: 'application/xml',
      });
      return;
    case 'deleteXmlPart':
      registry.deleteXmlPart(effect.name);
      return;
    case 'putRelationship':
      registry.putRelationship({ ...effect.record, ownerPart: effect.owner });
      return;
    case 'deleteRelationship':
      registry.deleteRelationship(effect.owner, effect.relationshipId);
      return;
    case 'putContentTypeOverride':
      registry.putContentTypeOverride(effect.partName, effect.mediaType);
      return;
    case 'deleteContentTypeOverride':
      registry.deleteContentTypeOverride(effect.partName);
      return;
    case 'putBinary':
      registry.putBinary(effect.descriptor);
      return;
    case 'deleteBinary':
      registry.deleteBinary(effect.storageKey);
      return;
  }
}

function isContentWitness(registry: DocumentRegistry, id: LogicalId): boolean {
  const kind = registry.kindOf(id);
  return kind !== null && !kind.endsWith('Properties');
}

/**
 * A join moves content children onto one survivor. A run split only moves `w:rPr` onto
 * the head run, and that overlap must not adopt the original text back onto the head.
 */
function inferReplacement(
  registry: DocumentRegistry,
  removedId: LogicalId,
  formerChildren: ReadonlyMap<LogicalId, readonly LogicalId[]>,
  effects: readonly CanonicalPrimitiveEffect[]
): LogicalId | undefined {
  const content = new Set(
    (formerChildren.get(removedId) ?? []).filter((id) => isContentWitness(registry, id))
  );
  if (content.size === 0) return undefined;
  for (const effect of effects) {
    if (effect.kind !== 'spliceChildren' || effect.parentLogicalId === removedId) continue;
    if (effect.childLogicalIds.some((childId) => content.has(childId))) {
      return effect.parentLogicalId;
    }
  }
  return undefined;
}

/** What applying a validated journal needs, gathered while it was validated. */
interface JournalPlan {
  /** Children a `spliceChildren` drops, named against the list each splice actually sees. */
  readonly removed: LogicalId[];
  /** Ids this journal puts back somewhere, so a removal is a move and not a death. */
  readonly reinserted: ReadonlySet<LogicalId>;
  /**
   * Text nodes this journal describes with a `putNode`, whatever shared state currently holds.
   *
   * The test cannot consult the registry. On a second apply the node already exists, so a
   * state-dependent test would call the replay an insert and duplicate the text again — the
   * bug this guards. What the registry does decide is whether the fill has already landed;
   * see `applyEffect`.
   */
  readonly mintedText: ReadonlySet<string>;
}

/**
 * Validate every effect, and record what applying them will need.
 *
 * Effects in one journal compose, so each is checked against the state its predecessors leave
 * behind. Everything gathered here replays the same effects against that same state, so it is
 * gathered in the same pass: a commit publishes its own journal now, and this runs on every
 * keystroke.
 *
 * Indices compose too. `removeNode` records the start as it stood AFTER the previous splice in
 * this transaction. Reading every start against the list from BEFORE the journal names the
 * wrong sibling — a comment-marker strip then tombstones the anchored run, and the peer loses
 * the text the markers wrapped.
 */
function planJournal(
  registry: DocumentRegistry,
  effects: readonly CanonicalPrimitiveEffect[]
): ApplyJournalResult | JournalPlan {
  const projection = new JournalProjection(registry);
  const removed: LogicalId[] = [];
  const reinserted = new Set<LogicalId>();
  const mintedText = new Set<string>();
  for (const effect of effects) {
    const refusal = validateEffect(registry, effect, projection);
    if (refusal) return refusal;
    if (effect.kind === 'spliceChildren') {
      const parent = effect.deleteCount > 0 ? projection.node(effect.parentLogicalId) : null;
      if (parent && !parent.isText) {
        const end = effect.start + effect.deleteCount;
        for (let at = effect.start; at < end; at += 1) {
          const childId = parent.children[at];
          if (childId !== undefined) removed.push(childId);
        }
      }
      for (const childId of effect.childLogicalIds) reinserted.add(childId);
    } else if (effect.kind === 'moveNode') {
      reinserted.add(effect.logicalId);
    } else if (effect.kind === 'putNode' && effect.descriptor.kind === 'textValue') {
      mintedText.add(effect.descriptor.logicalId);
    }
    projectEffect(projection, effect);
  }
  return { removed, reinserted, mintedText };
}

function mintedNodeCount(effects: readonly CanonicalPrimitiveEffect[]): number {
  let count = 0;
  for (const effect of effects) if (effect.kind === 'putNode') count += 1;
  return count;
}

/**
 * Apply one journal inside exactly one Y.Doc transaction.
 * Validation runs first. A refusal leaves shared state unchanged.
 *
 * A `putNode(textValue)` plus `spliceText(0, 0, value)` pair is the initial fill of that
 * shell. Apply treats it as a replacement of the node's current text so the journal stays
 * idempotent; a formatting split must never insert the same characters again.
 */
export function applyPrimitiveJournal(
  registry: DocumentRegistry,
  journal: CanonicalPrimitiveJournal
): ApplyJournalResult {
  if (registry.nodeCount() + mintedNodeCount(journal.effects) > registry.limits.maxNodes) {
    return { ok: false, code: 'too-many-nodes' };
  }
  // Nothing is written until every effect is admitted.
  const planned = planJournal(registry, journal.effects);
  if ('ok' in planned) return planned;
  registry.doc.transact(() => {
    // Inside the transaction, so the flag is set before Yjs can deliver the events that clear
    // it. A flush that runs while a remote update is still being processed opens a DEFERRED
    // transaction: shared state takes the edit now and the events arrive later, so anything
    // reading a derived index in between has to know it is looking at the older tree.
    registry.noteWrite();
    const formerChildren = captureChildLists(registry, planned.removed);
    for (const effect of journal.effects) applyEffect(registry, effect, planned.mintedText);
    tombstoneRemoved(registry, journal.effects, planned, formerChildren);
  }, JOURNAL_ORIGIN);
  return { ok: true };
}

function tombstoneRemoved(
  registry: DocumentRegistry,
  effects: readonly CanonicalPrimitiveEffect[],
  planned: JournalPlan,
  formerChildren: ReadonlyMap<LogicalId, readonly LogicalId[]>
): void {
  if (planned.removed.length === 0) return;
  // Read once. `partEntries` walks the whole part directory and sorts it, and asking it per
  // removed id gave the same answer every time.
  const partRoots = new Set<LogicalId>();
  for (const part of registry.partEntries()) partRoots.add(part.rootLogicalId);
  for (const id of planned.removed) {
    if (planned.reinserted.has(id) || !registry.hasNode(id) || registry.isTombstoned(id)) continue;
    if (partRoots.has(id)) continue;
    const survivor = inferReplacement(registry, id, formerChildren, effects);
    // The survivor adopts whatever the tombstone still lists, and the tombstone still lists
    // the children this edit REPLACED — a split run keeps the `w:t` the split superseded.
    // Dropping the seen children leaves the survivor adopting only what a concurrent peer
    // added, which is the case adoption exists for.
    if (survivor) registry.unlistChildren(id, formerChildren.get(id) ?? []);
    registry.tombstone(id, survivor);
  }
}

function captureChildLists(
  registry: DocumentRegistry,
  ids: readonly LogicalId[]
): Map<LogicalId, readonly LogicalId[]> {
  const lists = new Map<LogicalId, readonly LogicalId[]>();
  for (const id of ids) {
    const shape = registry.nodeShape(id);
    if (shape && !shape.isText) lists.set(id, shape.children);
  }
  return lists;
}
