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
import { JOURNAL_ORIGIN, isElementRecord } from './schema.ts';
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

function applyEffect(registry: DocumentRegistry, effect: CanonicalPrimitiveEffect): void {
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
  const record = registry.record(id);
  if (!record) return false;
  if (!isElementRecord(record)) return record.kind === 'textValue';
  return !record.kind.endsWith('Properties');
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

/**
 * Apply one journal inside exactly one Y.Doc transaction.
 * Validation runs first. A refusal leaves shared state unchanged.
 */
export function applyPrimitiveJournal(
  registry: DocumentRegistry,
  journal: CanonicalPrimitiveJournal
): ApplyJournalResult {
  if (
    registry.nodeCount() + journal.effects.filter((effect) => effect.kind === 'putNode').length >
    registry.limits.maxNodes
  ) {
    return { ok: false, code: 'too-many-nodes' };
  }
  // Effects in one journal compose, so each is checked against the state its predecessors
  // leave behind. Nothing is written until every effect is admitted.
  const projection = new JournalProjection(registry);
  for (const effect of journal.effects) {
    const refusal = validateEffect(registry, effect, projection);
    if (refusal) return refusal;
    projectEffect(projection, effect);
  }
  registry.doc.transact(() => {
    const removedBefore = captureRemovedChildren(registry, journal.effects);
    const formerChildren = captureChildLists(registry, removedBefore);
    const reinserted = new Set<LogicalId>();
    for (const effect of journal.effects) {
      if (effect.kind === 'spliceChildren') {
        for (const childId of effect.childLogicalIds) reinserted.add(childId);
      }
      if (effect.kind === 'moveNode') reinserted.add(effect.logicalId);
    }
    for (const effect of journal.effects) applyEffect(registry, effect);
    for (const id of removedBefore) {
      if (reinserted.has(id) || !registry.hasNode(id) || registry.isTombstoned(id)) continue;
      if (registry.partEntries().some((part) => part.rootLogicalId === id)) continue;
      registry.tombstone(id, inferReplacement(registry, id, formerChildren, journal.effects));
    }
  }, JOURNAL_ORIGIN);
  return { ok: true };
}

function captureRemovedChildren(
  registry: DocumentRegistry,
  effects: readonly CanonicalPrimitiveEffect[]
): LogicalId[] {
  const removed: LogicalId[] = [];
  for (const effect of effects) {
    if (effect.kind === 'spliceChildren' && effect.deleteCount > 0) {
      const parent = registry.record(effect.parentLogicalId);
      if (!parent || !isElementRecord(parent)) continue;
      removed.push(...parent.childIds.slice(effect.start, effect.start + effect.deleteCount));
    }
  }
  return removed;
}

function captureChildLists(
  registry: DocumentRegistry,
  ids: readonly LogicalId[]
): Map<LogicalId, readonly LogicalId[]> {
  const lists = new Map<LogicalId, readonly LogicalId[]>();
  for (const id of ids) {
    const record = registry.record(id);
    if (record && isElementRecord(record)) lists.set(id, record.childIds);
  }
  return lists;
}
