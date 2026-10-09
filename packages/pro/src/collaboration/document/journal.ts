/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { projectedTextTarget } from './projected-text-target.ts';
import { routeInlineEffects, type InlinePlan } from './paragraph-text-writer.ts';
import { recordRelocatedMarkers } from './relocated-markers.ts';
import { writeTypedInsert, type TypedInsert } from './paragraph-text-typing.ts';
import {
  applyInlinePlan,
  deleteCopiesOfRemoved,
  deleteEmbedsOfRemoved,
  deleteHeldOriginals,
  recordDeletions,
  type InlineWritten,
} from './paragraph-text-apply.ts';
import {
  recordSplitAcrossParents,
  recordSplitTextSources,
  runTextPending,
  splitProductsOf,
} from './split-text-recording.ts';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration/replication';
import type { LogicalId } from './identity.ts';
import { sharedEffect, type SharedEffect, type SharedNodeDescriptor } from './shared-effect.ts';
import {
  rejectBlobDescriptor,
  rejectDangerousKey,
  rejectPartName,
  rejectString,
  type LimitCode,
} from './limits.ts';
import { isNodeMap, JOURNAL_ORIGIN, mapFieldArriving } from './schema.ts';
import { INLINE_FIELD } from './paragraph-text.ts';
import { SharedTextValueRefused } from './paragraph-text-codec.ts';
import { tokensOfParagraph, type Token } from './paragraph-text-diff.ts';
import { JournalProjection, projectEffect } from './journal-projection.ts';
import type { DocumentRegistry } from './registry.ts';

export type JournalRefusalCode =
  | LimitCode
  | 'unknown-logical-id'
  | 'invalid-bound'
  | 'partial-apply-forbidden';

export type ApplyJournalResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: JournalRefusalCode;
      readonly detail?: string;
      /** The refusal waits on a peer's update in flight; the same edit can succeed later. */
      readonly transient?: true;
    };

function requireKnown(projection: JournalProjection, id: LogicalId): ApplyJournalResult | null {
  if (rejectDangerousKey(id) || id.length === 0) {
    return { ok: false, code: 'prototype-key', detail: id };
  }
  if (!projection.has(id)) return { ok: false, code: 'unknown-logical-id', detail: id };
  return null;
}

function validateDescriptor(
  registry: DocumentRegistry,
  descriptor: SharedNodeDescriptor,
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

export function validateEffect(
  registry: DocumentRegistry,
  effect: SharedEffect,
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
        if (
          effect.start + effect.deleteCount > parent.children.length &&
          !appendsToPartRoot(registry, effect, parent.children.length)
        ) {
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
      if (registry.partCount() >= registry.limits.maxParts) {
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
      if (registry.relationshipCount() >= registry.limits.maxRelationships) {
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

/**
 * A delete followed by an insert at the same place in one text is one replacement, written
 * as one splice so shared text can place the new characters before the ones they replace.
 * Typing over a selection arrives this way. Both forms leave the same text.
 */
function mergeTextReplacements(effects: readonly SharedEffect[]): SharedEffect[] {
  const merged: SharedEffect[] = [];
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index]!;
    const next = effects[index + 1];
    if (
      effect.kind === 'spliceText' &&
      effect.deleteCount > 0 &&
      effect.insert.length === 0 &&
      next?.kind === 'spliceText' &&
      next.logicalId === effect.logicalId &&
      next.utf16Start === effect.utf16Start &&
      next.deleteCount === 0 &&
      // A split-text slice keeps delete-first: a merged edit of one would write past the
      // slice into its source.
      !projectedTextTarget(effect) &&
      !projectedTextTarget(next)
    ) {
      merged.push({ ...effect, insert: next.insert });
      index += 1;
      continue;
    }
    merged.push(effect);
  }
  return merged;
}

function applyEffect(
  registry: DocumentRegistry,
  effect: SharedEffect,
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
      const target = projectedTextTarget(effect);
      registry.spliceText(
        target?.logicalId ?? effect.logicalId,
        target?.utf16Start ?? effect.utf16Start,
        effect.deleteCount,
        effect.insert
      );
      return;
    case 'setAttribute':
      registry.setAttribute(effect.logicalId, effect.qname, effect.value);
      return;
    case 'setNamespaceBinding':
      registry.setNamespaceBinding(effect.logicalId, effect.prefix, effect.uri);
      return;
    case 'spliceChildren': {
      const listed = registry.record(effect.parentLogicalId);
      const length = listed && 'childIds' in listed ? listed.childIds.length : effect.start;
      registry.spliceChildren(
        effect.parentLogicalId,
        appendsToPartRoot(registry, effect, length) ? length : effect.start,
        effect.deleteCount,
        effect.childLogicalIds
      );
      return;
    }
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
  effects: readonly SharedEffect[]
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
   * Nodes the journal's last change to removes: a node it moved and then removed is gone, as
   * one it only removed is. A part root lists adopted members where they show before an
   * edit addresses it, so deleting an adopted member moves it first.
   */
  readonly unlistedAtEnd: ReadonlySet<LogicalId>;
  /**
   * Text nodes this journal describes with a `putNode`, whatever shared state currently holds.
   *
   * The test cannot consult the registry. On a second apply the node already exists, so a
   * state-dependent test would call the replay an insert and duplicate the text again — the
   * bug this guards. What the registry does decide is whether the fill has already landed;
   * see `applyEffect`.
   */
  readonly mintedText: ReadonlySet<string>;
  /** Nodes created or described by this journal, including intermediate format runs. */
  readonly mintedNodes: ReadonlySet<string>;
  /**
   * For each replacement splice, the ids it removed in effect order.
   *
   * A format split removes one run and inserts its head/tail at that slot; this is how a
   * later tombstone learns which runs replaced the dropped one, so two concurrent splits of
   * one run can be de-duplicated deterministically instead of duplicating the text (#581).
   */
  readonly replacementsByEffect: ReadonlyMap<SharedEffect, readonly LogicalId[]>;
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
  effects: readonly SharedEffect[]
): ApplyJournalResult | JournalPlan {
  const projection = new JournalProjection(registry);
  const removed: LogicalId[] = [];
  const reinserted = new Set<LogicalId>();
  const unlistedAtEnd = new Set<LogicalId>();
  const mintedText = new Set<string>();
  const mintedNodes = new Set<string>();
  const replacementsByEffect = new Map<SharedEffect, LogicalId[]>();
  for (const effect of effects) {
    const refusal = validateEffect(registry, effect, projection);
    if (refusal) return refusal;
    if (effect.kind === 'spliceChildren') {
      const parent = effect.deleteCount > 0 ? projection.node(effect.parentLogicalId) : null;
      if (parent && !parent.isText) {
        const end = effect.start + effect.deleteCount;
        for (let at = effect.start; at < end; at += 1) {
          const childId = parent.children[at];
          if (childId === undefined) continue;
          removed.push(childId);
          unlistedAtEnd.add(childId);
          // The runs this same splice inserts at the dropped slot are its replacements.
          if (effect.childLogicalIds.length > 0) {
            const ids = replacementsByEffect.get(effect) ?? [];
            ids.push(childId);
            replacementsByEffect.set(effect, ids);
          }
        }
      }
      for (const childId of effect.childLogicalIds) {
        reinserted.add(childId);
        unlistedAtEnd.delete(childId);
      }
    } else if (effect.kind === 'moveNode') {
      reinserted.add(effect.logicalId);
      unlistedAtEnd.delete(effect.logicalId);
    } else if (effect.kind === 'putNode') {
      mintedNodes.add(effect.descriptor.logicalId);
      if (effect.descriptor.kind === 'textValue') mintedText.add(effect.descriptor.logicalId);
    }
    projectEffect(projection, effect);
  }
  return { removed, reinserted, unlistedAtEnd, mintedText, mintedNodes, replacementsByEffect };
}

function mintedNodeCount(effects: readonly SharedEffect[]): number {
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
  given: CanonicalPrimitiveJournal,
  routed?: InlinePlan | null,
  /** Typing the projection found it can write straight to its paragraph's text. */
  typed?: TypedInsert
): ApplyJournalResult {
  if (typed) {
    let written = false;
    registry.doc.transact(() => {
      registry.noteWrite();
      written = writeTypedInsert(registry, typed);
    }, JOURNAL_ORIGIN);
    // The text changed between planning and writing: nothing was written, so the editor's
    // tree takes shared state back.
    return written
      ? { ok: true }
      : { ok: false, code: 'invalid-bound', detail: 'typed text changed', transient: true };
  }
  // A journal the projection did not route (one in shared coordinates already) is routed
  // here, so paragraph inline content always goes to shared text.
  let plan = routed;
  let journal = given;
  if (plan === undefined) {
    const routed = routeInlineEffects(registry, given.effects);
    if (routed.refusal) return { ok: false, ...routed.refusal };
    plan = routed.plan;
    if (plan) journal = { ...given, effects: routed.passThrough };
  }
  const effects = journal.effects.map(sharedEffect);
  if (registry.nodeCount() + mintedNodeCount(effects) > registry.limits.maxNodes) {
    return { ok: false, code: 'too-many-nodes' };
  }
  // Nothing is written until every effect is admitted.
  const planned = planJournal(registry, effects);
  if ('ok' in planned) return planned;
  for (const removed of planned.replacementsByEffect.values()) {
    for (const id of removed) {
      if (registry.kindOf(id) === 'run' && runTextPending(registry, id)) {
        return {
          ok: false,
          code: 'invalid-bound',
          detail: `split of pending text in ${id}`,
          transient: true,
        };
      }
    }
  }
  const arriving = plan?.paragraphs.find(
    ({ id }) => registry.inline.textOf(id) === null && paragraphTextArriving(registry, id)
  );
  if (arriving) {
    // Its text is in an update Yjs holds back. A text written now would replace the author's.
    return {
      ok: false,
      code: 'invalid-bound',
      detail: `pending text of paragraph ${arriving.id}`,
      transient: true,
    };
  }
  // Every paragraph is encoded before anything is written: a value too large for the shared
  // text refuses the edit here, where nothing has changed yet.
  let tokens: ReadonlyMap<LogicalId, Token[]>;
  try {
    tokens = new Map(
      plan?.paragraphs.map(({ id, after }) => [id, tokensOfParagraph(after, registry.limits)])
    );
  } catch (error) {
    if (!(error instanceof SharedTextValueRefused)) throw error;
    return { ok: false, code: error.code, detail: error.detail };
  }
  registry.doc.transact(() => {
    // Inside the transaction, so the flag is set before Yjs can deliver the events that clear
    // it. A flush that runs while a remote update is still being processed opens a DEFERRED
    // transaction: shared state takes the edit now and the events arrive later, so anything
    // reading a derived index in between has to know it is looking at the older tree.
    registry.noteWrite();
    const formerChildren = captureChildLists(registry, planned.removed);
    const unaliased: { removedId: LogicalId; runs: LogicalId[] }[] = [];
    const insertedRuns: LogicalId[] = [];
    for (const effect of mergeTextReplacements(effects)) {
      applyEffect(registry, effect, planned.mintedText);
      if (effect.kind === 'spliceChildren') {
        // Only a split that moves the tail into a paragraph this journal created (Enter) can
        // carry a run's text across parents; formatting splits stay within one parent.
        if (planned.mintedNodes.has(effect.parentLogicalId)) {
          for (const id of effect.childLogicalIds) {
            if (planned.mintedNodes.has(id) && registry.kindOf(id) === 'run') insertedRuns.push(id);
          }
        }
        recordSplitProvenance(
          registry,
          planned,
          planned.replacementsByEffect.get(effect) ?? [],
          effect.childLogicalIds,
          unaliased
        );
      }
    }
    recordSplitAcrossParents(registry, unaliased, insertedRuns, (removedId, tail) => {
      registry.recordRunSplit(
        resolveSplitRoot(registry, removedId, planned.reinserted),
        removedId,
        tail
      );
    });
    tombstoneRemoved(registry, effects, planned, formerChildren);
    const removed = deleteCopiesOfRemoved(registry, planned.removed);
    const written: InlineWritten = plan
      ? applyInlinePlan(registry, plan, tokens)
      : { copied: new Set<string>(), deleted: new Set<string>(), embedded: new Set<string>() };
    recordRelocatedMarkers(registry, planned.removed, written.embedded, planned.mintedNodes);
    deleteHeldOriginals(registry, removed.held, written.copied);
    recordDeletions(registry, written, removed.shown);
    deleteEmbedsOfRemoved(registry, removed.embeds, planned.removed, written);
  }, JOURNAL_ORIGIN);
  return { ok: true };
}

/**
 * Whether an edit of this paragraph waits for an update shared state holds back: its text,
 * or the text of one of its runs, is in that update. The journal would be refused after the
 * editor committed it, so the operation gate refuses it first.
 */
export function paragraphEditWaits(registry: DocumentRegistry, paragraphId: LogicalId): boolean {
  if (registry.inline.textOf(paragraphId) === null && paragraphTextArriving(registry, paragraphId))
    return true;
  const record = registry.record(paragraphId);
  const children = record && 'childIds' in record ? record.childIds : [];
  return children.some((id) => registry.kindOf(id) === 'run' && runTextPending(registry, id));
}

/** As `paragraphEditWaits`, for the paragraph that holds a node, or the node itself. */
export function editWaits(registry: DocumentRegistry, id: LogicalId): boolean {
  const paragraph =
    registry.kindOf(id) === 'paragraph' ? id : (registry.inline.owner(id) ?? registry.parentOf(id));
  return paragraph !== null && paragraphEditWaits(registry, paragraph);
}

function paragraphTextArriving(registry: DocumentRegistry, id: LogicalId): boolean {
  const record = registry.schema.nodes.get(id);
  return isNodeMap(record) && mapFieldArriving(record, INLINE_FIELD);
}

function tombstoneRemoved(
  registry: DocumentRegistry,
  effects: readonly SharedEffect[],
  planned: JournalPlan,
  formerChildren: ReadonlyMap<LogicalId, readonly LogicalId[]>
): void {
  if (planned.removed.length === 0) return;
  // Read once. `partEntries` walks the whole part directory and sorts it, and asking it per
  // removed id gave the same answer every time.
  const partRoots = new Set<LogicalId>();
  for (const part of registry.partEntries()) partRoots.add(part.rootLogicalId);
  for (const id of planned.removed) {
    // A node the journal moved and left listed survives; one it moved and then removed does not.
    if (planned.reinserted.has(id) && !planned.unlistedAtEnd.has(id)) continue;
    if (!registry.hasNode(id) || registry.isTombstoned(id)) continue;
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

/**
 * Stamp each run a format split minted with the run it replaced (#581).
 *
 * Record immediately after each replacement, including intermediate runs split again in
 * this journal. Later effects then inherit the original shared characters and split origin.
 */
function recordSplitProvenance(
  registry: DocumentRegistry,
  planned: JournalPlan,
  removedIds: readonly LogicalId[],
  insertedIds: readonly LogicalId[],
  unaliased: { removedId: LogicalId; runs: LogicalId[] }[]
): void {
  for (const removedId of removedIds) {
    const kind = registry.kindOf(removedId);
    if (kind !== 'run' && kind !== 'text') continue;
    // A pre-existing node moved elsewhere was not replaced by this splice. Only intermediate
    // nodes minted in this journal can be reinserted split ancestors.
    if (planned.reinserted.has(removedId) && !planned.mintedNodes.has(removedId)) continue;
    const root = resolveSplitRoot(registry, removedId, planned.reinserted);
    if (kind === 'text') {
      // An inline element (a line break or a tab) inserted inside a run replaces its `w:t`
      // with the text on either side. The new text aliases the old, so concurrent typing
      // follows it; and the whole replacement, element included, joins the split dedup, so two
      // peers splitting the same `w:t` keep one replacement instead of the text twice (#1129).
      const texts = splitProductsOf(kind, insertedIds, (id) => registry.kindOf(id));
      if (texts && recordSplitTextSources(registry, removedId, texts)) {
        const minted = insertedIds.filter((id) => planned.mintedNodes.has(id));
        registry.recordRunSplit(root, removedId, minted);
      }
      continue;
    }
    const runs = insertedIds.filter((runId) => registry.kindOf(runId) === 'run');
    if (!recordSplitTextSources(registry, removedId, runs)) unaliased.push({ removedId, runs });
    registry.recordRunSplit(root, removedId, runs);
  }
}

/**
 * The run a split op started from, climbing through the intermediate runs THIS journal created.
 *
 * One op splits at both edges: it makes an intermediate run, then splits that. The intermediate
 * is in `reinserted`, so climb its `splitFrom` to group every product of the op under the one
 * run it superseded. Stop at a run from an EARLIER round — a later split of a survivor is its own
 * origin, so two peers concurrently splitting that survivor meet at it and dedup, instead of one
 * peer climbing past it to a stale ancestor while the other stops there.
 */
function resolveSplitRoot(
  registry: DocumentRegistry,
  removedId: LogicalId,
  reinserted: ReadonlySet<LogicalId>
): LogicalId {
  let root = removedId;
  for (let depth = 0; depth < registry.limits.maxTreeDepth; depth += 1) {
    if (!reinserted.has(root)) break;
    const parent = registry.splitOriginOf(root);
    if (parent === null || parent === root) break;
    root = parent;
  }
  return root;
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

/**
 * Whether a splice inserts past the end of a part root's listed children. The materializer
 * shows a part's members, such as notes, sorted, and also those no parent lists any more,
 * which an undo of their insert leaves behind. The editor counts those, so an insert at its
 * end can stand past the listed children; it is appended, and the sort places it.
 */
function appendsToPartRoot(
  registry: DocumentRegistry,
  effect: {
    readonly parentLogicalId: string;
    readonly start: number;
    readonly deleteCount: number;
  },
  length: number
): boolean {
  return (
    effect.deleteCount === 0 &&
    effect.start > length &&
    registry.partEntries().some((entry) => entry.rootLogicalId === effect.parentLogicalId)
  );
}
