/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { projectedTextTarget, withProjectedTarget } from './projected-text-target.ts';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration/replication';
import { validateEffect, type ApplyJournalResult } from './journal.ts';
import { JournalProjection, projectEffect } from './journal-projection.ts';
import {
  recordSplitTextSources,
  splitProductsOf,
  type SplitTextRecordingRegistry,
} from './split-text-recording.ts';
import { SplitTextSources, type SplitTextRange } from './split-text-sources.ts';
import { captureInsertionBoundary } from './split-text-boundaries.ts';
import {
  MERGED_KINDS,
  sharedChildShell,
  singletonLayout,
  type ChildShell,
} from './singleton-children.ts';
import { PACKAGE_NODES_KEY, NODE_TEXT_FIELD, makeTextRecord, type SharedRecord } from './schema.ts';
import { splitWinnerOrder } from './split-dedup.ts';
import { typedInsertOf, type TypedInsert } from './paragraph-text-typing.ts';
import type { DocumentRegistry } from './registry.ts';
import type { LogicalId } from './identity.ts';
import { sharedEffect, type SharedEffect, type SharedNodeDescriptor } from './shared-effect.ts';
import { routeInlineEffects, type InlinePlan } from './paragraph-text-writer.ts';

type ProjectionRefusal = Extract<ApplyJournalResult, { readonly ok: false }>;

interface TextSplice {
  readonly start: number;
  readonly deleted: number;
  readonly inserted: string;
  readonly keepBoundary: boolean;
  readonly ambiguousBoundary: boolean;
}
interface ProjectedRange extends Omit<SplitTextRange, 'text' | 'start' | 'end'> {
  start: number;
  end: number;
  revision: number;
}

function transformPosition(position: number, assoc: number, splice: TextSplice): number {
  if (splice.keepBoundary && position === splice.start) return position;
  const deleted =
    position <= splice.start ? position : Math.max(splice.start, position - splice.deleted);
  return deleted < splice.start || (deleted === splice.start && assoc < 0)
    ? deleted
    : deleted + splice.inserted.length;
}
type TextAction =
  | {
      readonly kind: 'splice';
      readonly effect: Extract<SharedEffect, { kind: 'spliceText' }>;
    }
  | {
      readonly kind: 'register';
      readonly product: LogicalId;
      readonly source: LogicalId;
      readonly start: number;
      readonly end: number;
    };

/**
 * A single aliased keystroke needs only one range read. Compound edits can delete an anchor
 * and later insert into its old gap: numeric offset arithmetic cannot reproduce Yjs's deleted
 * item ordering. Lazily replay those uncommon journals against a disposable Yjs snapshot.
 */
class TextCoordinates {
  private readonly ranges = new Map<LogicalId, ProjectedRange | null>();
  private readonly histories = new Map<LogicalId, TextSplice[]>();
  private readonly strings = new Map<LogicalId, string>();
  private readonly actions: TextAction[] = [];
  private shadow: { doc: Y.Doc; nodes: Y.Map<Y.Map<unknown>>; sources: SplitTextSources } | null =
    null;

  constructor(
    private readonly registry: DocumentRegistry,
    private readonly raw: JournalProjection
  ) {}

  range(id: LogicalId): ProjectedRange | null {
    if (this.shadow) {
      const range = this.shadow.sources.range(id);
      return range ? { ...range, revision: 0 } : null;
    }
    if (!this.ranges.has(id)) {
      const range = this.registry.splitTextRange(id);
      this.ranges.set(id, range ? { ...range, revision: 0 } : null);
    }
    const range = this.ranges.get(id)!;
    if (range) {
      const history = this.histories.get(range.sourceId) ?? [];
      while (range.revision < history.length) {
        const splice = history[range.revision]!;
        const deletesAnchor = (offset: number, assoc: number): boolean => {
          const at = assoc < 0 ? offset - 1 : offset;
          return at >= splice.start && at < splice.start + splice.deleted;
        };
        if (
          range.startAnchorDeleted ||
          range.endAnchorDeleted ||
          splice.ambiguousBoundary ||
          deletesAnchor(range.start, range.startAssoc) ||
          deletesAnchor(range.end, range.endAssoc)
        ) {
          this.ensureShadow();
          const exact = this.shadow!.sources.range(id);
          return exact ? { ...exact, revision: 0 } : null;
        }
        range.start = transformPosition(range.start, range.startAssoc, splice);
        range.end = transformPosition(range.end, range.endAssoc, splice);
        range.revision += 1;
      }
    }
    return range;
  }

  value(id: LogicalId): string {
    const range = this.range(id);
    if (range) return this.value(range.sourceId).slice(range.start, range.end);
    let value = this.strings.get(id);
    if (value === undefined) {
      value = this.registry.hasNode(id) ? this.registry.textOf(id).toString() : '';
      for (const splice of this.histories.get(id) ?? []) {
        value =
          value.slice(0, splice.start) +
          splice.inserted +
          value.slice(splice.start + splice.deleted);
      }
      this.strings.set(id, value);
    }
    return value;
  }

  apply(effect: Extract<SharedEffect, { kind: 'spliceText' }>): void {
    const target = projectedTextTarget(effect);
    const range = target ? this.range(target.logicalId) : null;
    const splice = {
      keepBoundary:
        target?.utf16Start === 0 && range?.startAssoc !== -1 && effect.insert.length > 0,
      ambiguousBoundary: range !== null && range.start === range.end && effect.insert.length > 0,
      start: effect.utf16Start,
      deleted: effect.deleteCount,
      inserted: effect.insert,
    };
    const history = this.histories.get(effect.logicalId) ?? [];
    history.push(splice);
    this.histories.set(effect.logicalId, history);
    const value = this.strings.get(effect.logicalId);
    if (value !== undefined)
      this.strings.set(
        effect.logicalId,
        value.slice(0, splice.start) + splice.inserted + value.slice(splice.start + splice.deleted)
      );
    const action: TextAction = { kind: 'splice', effect };
    this.actions.push(action);
    if (this.shadow) this.replay(action);
  }

  register(product: LogicalId, source: LogicalId, start: number, end: number): void {
    const inherited = this.range(source);
    const sourceId = inherited?.sourceId ?? source;
    const sourceStart = inherited?.start ?? 0;
    const length = inherited
      ? inherited.end - inherited.start
      : (this.raw.node(source)?.textLength ?? 0);
    // Match SplitTextSources.register exactly, including empty prefixes/suffixes:
    // their two endpoints can inherit the same outer sentinel or deleted anchor.
    const boundary = (offset: number, edge: 'start' | 'end') => {
      if (inherited && edge === 'end' && offset === length) {
        return { assoc: inherited.endAssoc, deleted: inherited.endAnchorDeleted };
      }
      if (inherited && offset === 0) {
        return { assoc: inherited.startAssoc, deleted: inherited.startAnchorDeleted };
      }
      if (inherited && offset === length) {
        return { assoc: inherited.endAssoc, deleted: inherited.endAnchorDeleted };
      }
      return { assoc: sourceStart + offset === 0 && edge === 'start' ? -1 : 0, deleted: false };
    };
    const first = boundary(start, 'start');
    const last = boundary(end, 'end');
    this.ranges.set(product, {
      sourceId,
      start: sourceStart + start,
      end: sourceStart + end,
      startAssoc: first.assoc,
      endAssoc: last.assoc,
      startAnchorDeleted: first.deleted,
      endAnchorDeleted: last.deleted,
      revision: this.histories.get(sourceId)?.length ?? 0,
    });
    const action: TextAction = { kind: 'register', product, source, start, end };
    this.actions.push(action);
    if (this.shadow) this.replay(action);
  }

  destroy(): void {
    this.shadow?.doc.destroy();
  }

  private ensureShadow(): void {
    if (this.shadow) return;
    const doc = new Y.Doc({ gc: false });
    const nodes = doc.getMap<Y.Map<unknown>>(PACKAGE_NODES_KEY);
    this.shadow = { doc, nodes, sources: new SplitTextSources(nodes, doc, this.registry.limits) };
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(this.registry.doc));
    // Only local simulation follows; matching the author also preserves Yjs insertion ordering.
    doc.clientID = this.registry.doc.clientID;
    this.shadow.sources.reset();
    for (const action of this.actions) this.replay(action);
  }

  private replay(action: TextAction): void {
    const shadow = this.shadow!;
    const ensureText = (id: LogicalId): Y.Text => {
      if (!shadow.nodes.has(id)) shadow.nodes.set(id, makeTextRecord(''));
      return shadow.nodes.get(id)!.get(NODE_TEXT_FIELD) as Y.Text;
    };
    if (action.kind === 'register') {
      ensureText(action.product);
      shadow.sources.register(action.product, action.source, action.start, action.end);
      return;
    }
    const { effect } = action;
    const target = projectedTextTarget(effect);
    const range = target ? shadow.sources.range(target.logicalId) : null;
    const text = range?.text ?? ensureText(effect.logicalId);
    const offset = target?.utf16Start ?? effect.utf16Start;
    const start = (range?.start ?? 0) + offset;
    const restore = captureInsertionBoundary(
      shadow.nodes,
      shadow.sources,
      target?.logicalId ?? effect.logicalId,
      range,
      offset,
      effect.insert
    );
    if (effect.deleteCount > 0) text.delete(start, effect.deleteCount);
    if (effect.insert.length > 0) text.insert(start, effect.insert);
    restore?.();
  }
}

/** The same lazy scratch model, with visible child lists and current source slice lengths. */
class VisibleJournalProjection extends JournalProjection {
  private readonly filtered = new Set<LogicalId>();
  constructor(
    private readonly shared: DocumentRegistry,
    private readonly visibleIndexes: (
      parentId: LogicalId,
      children: readonly LogicalId[]
    ) => number[],
    private readonly raw: JournalProjection,
    private readonly text: TextCoordinates,
    /** Children a winning property container shows from its hidden copies, after its own. */
    private readonly mergedOf: (id: LogicalId) => readonly LogicalId[] = () => [],
    /** The children a member part's root shows, adopted members included, in their order. */
    private readonly shownOf: (id: LogicalId) => readonly LogicalId[] | null = () => null
  ) {
    super(shared);
  }
  override node(id: LogicalId): ReturnType<JournalProjection['node']> {
    const node = super.node(id);
    if (node && !this.filtered.has(id)) {
      this.filtered.add(id);
      // A join survivor shows the children it adopts after its own, as the materializer
      // does, so a local edit's indexes and this projection count the same children.
      const adopted = [...this.shared.adoptedChildren(id), ...this.mergedOf(id)].filter(
        (child, at, all) => !node.children.includes(child) && all.indexOf(child) === at
      );
      const children = adopted.length > 0 ? [...node.children, ...adopted] : node.children;
      node.children =
        this.shownOf(id)?.slice() ??
        this.visibleIndexes(id, children).map((index) => children[index]!);
    }
    if (node?.isText) {
      const range = this.text.range(id);
      node.textLength = range
        ? range.end - range.start
        : (this.raw.node(id)?.textLength ?? node.textLength);
    }
    return node;
  }
}

/**
 * A journal in shared coordinates, and what it writes to paragraph texts. Apply passes the
 * plan on, so the journal is not routed a second time.
 */
export interface ProjectedJournal {
  readonly ok: true;
  readonly journal: CanonicalPrimitiveJournal;
  readonly plan: InlinePlan | null;
  /** Typing at one place, written straight to its paragraph's text (`typedInsertOf`). */
  readonly typed?: TypedInsert;
}

/**
 * A local journal in shared coordinates: typing at one place as the insert it writes
 * (`typedInsertOf`), and any other journal projected (`projectJournalToShared`).
 */
export function projectTypingOrJournal(
  registry: DocumentRegistry,
  original: CanonicalPrimitiveJournal,
  shownPartChildren?: (rootId: LogicalId) => readonly LogicalId[] | null
): ProjectedJournal | ProjectionRefusal {
  const typed = typedInsertOf(registry, original);
  if (typed) return { ok: true, journal: { ...original, effects: [] }, plan: null, typed };
  return projectJournalToShared(registry, original, shownPartChildren);
}

/**
 * Canonical journals address the visible tree. Concurrent split losers remain in Yjs for
 * undo, so their array entries must not shift a later edit onto a different run. Translate
 * against scratch trees in effect order. Validate before replaying either coordinate form:
 * scratch splices allocate too, so oversized input must reach the ordinary refusal path.
 */
export function projectJournalToShared(
  registry: DocumentRegistry,
  original: CanonicalPrimitiveJournal,
  shownPartChildren: (rootId: LogicalId) => readonly LogicalId[] | null = () => null
): ProjectedJournal | ProjectionRefusal {
  // Paragraph inline content is written to shared text; only the rest is projected here.
  const routed = routeInlineEffects(registry, original.effects);
  if (routed.refusal) return { ok: false, ...routed.refusal };
  const journal = routed.plan ? { ...original, effects: routed.passThrough } : original;
  const incoming = journal.effects.map(sharedEffect);
  const hidden = registry.replacementLoserRuns();
  const minted = incoming.filter((effect) => effect.kind === 'putNode').length;
  if (registry.nodeCount() + minted > registry.limits.maxNodes) {
    return { ok: false, code: 'too-many-nodes' };
  }
  // Bound incoming lists before collecting future moves. Do not flatten unvalidated
  // child arrays into an additional unbounded allocation.
  const reinserted = new Set<LogicalId>();
  for (const effect of incoming) {
    if (effect.kind === 'spliceChildren') {
      if (effect.childLogicalIds.length > registry.limits.maxChildren)
        return { ok: false, code: 'too-many-children' };
      for (const id of effect.childLogicalIds) reinserted.add(id);
    } else if (effect.kind === 'moveNode') {
      reinserted.add(effect.logicalId);
    }
    if (reinserted.size > registry.limits.maxNodes) return { ok: false, code: 'too-many-nodes' };
  }
  const raw = new JournalProjection(registry);
  const text = new TextCoordinates(registry, raw);
  const visible = new VisibleJournalProjection(
    registry,
    (parentId, children) => visibleIndexes(parentId, children),
    raw,
    text,
    (id) => mergedChildrenOf(id),
    (id) => shownPartChildren(id)
  );
  const descriptors = new Map<LogicalId, SharedNodeDescriptor>();
  const kindOf = (id: LogicalId): string | null => descriptors.get(id)?.kind ?? registry.kindOf(id);
  const shellOf = (id: LogicalId): ChildShell | null => {
    const descriptor = descriptors.get(id);
    if (!descriptor) return sharedChildShell(registry, id);
    return descriptor.kind === 'textValue'
      ? { kind: 'textValue', namespaceUri: '', localName: '' }
      : {
          kind: descriptor.kind,
          namespaceUri: descriptor.qname.namespaceUri,
          localName: descriptor.qname.localName,
        };
  };
  // Indexes of the children a replica shows under `parentId`, in the order it shows them.
  // This is the materializer's rule, so a local edit's visible indexes map back exactly:
  // no split losers, tombstones, repeats, or self-listing, and one copy of each singleton a
  // concurrent peer duplicated. A node this journal creates is live by definition.
  // `companions` maps a shown singleton's index to the hidden copies it stands for.
  const visibleLayout = (
    parentId: LogicalId,
    children: readonly LogicalId[]
  ): { positions: number[]; companions: ReadonlyMap<number, readonly number[]> } => {
    const seen = new Set<LogicalId>();
    const base: number[] = [];
    const order =
      hidden.size === 0
        ? null
        : splitWinnerOrder(
            children,
            (id) => hidden.has(id),
            (id) => registry.splitLineageOf(id)
          );
    (order ?? children.map((_, index) => index)).forEach((index) => {
      const id = children[index]!;
      if (id === parentId || seen.has(id) || hidden.has(id)) return;
      seen.add(id);
      // A tombstone is not shown, nor is a child whose record has not arrived yet, nor a split
      // text whose source has not: the materializer shows none of them. One record read, as
      // Enter in a long document reads this for every block.
      if (!descriptors.has(id) && !registry.showsAsChild(id)) return;
      base.push(index);
    });
    const layout = singletonLayout(
      kindOf(parentId),
      base.map((index) => children[index]!),
      shellOf
    );
    if (!layout) return { positions: base, companions: new Map() };
    const companions = new Map<number, readonly number[]>();
    for (const [winner, losers] of layout.companions) {
      companions.set(
        base[winner]!,
        losers.map((at) => base[at]!)
      );
    }
    return { positions: layout.order.map((at) => base[at]!), companions };
  };
  const visibleIndexes = (parentId: LogicalId, children: readonly LogicalId[]): number[] =>
    visibleLayout(parentId, children).positions;
  const permuted = (positions: readonly number[]): boolean =>
    positions.some((index, at) => at > 0 && index < positions[at - 1]!);
  // The shared index at which `ids` land at visible index `visibleAt`. In shared order that is
  // before the child shown there. A conflict layout can move a leading `w:pPr` forward or the
  // paragraph mark's `w:rPr` back, and then no single rule fits both: try the slot before the
  // child shown at `visibleAt`, after the one shown before it, and the end, and keep the one
  // the same layout rule shows where the author put the children.
  const insertionIndex = (
    parentId: LogicalId,
    children: readonly LogicalId[],
    visibleAt: number,
    ids: readonly LogicalId[]
  ): number => {
    const positions = visibleIndexes(parentId, children);
    const before = positions[visibleAt] ?? children.length;
    if (!permuted(positions)) return before;
    const after = visibleAt > 0 ? positions[visibleAt - 1]! + 1 : 0;
    for (const at of [before, after, children.length]) {
      const next = [...children.slice(0, at), ...ids, ...children.slice(at)];
      const shown = visibleIndexes(parentId, next).map((index) => next[index]);
      if (ids.every((id, offset) => shown[visibleAt + offset] === id)) return at;
    }
    return before;
  };
  // A node can be listed by two parents after concurrent moves, and the one this replica
  // shows it under won the placement. Deleting that parent deletes what the author saw in
  // it, so every other listing of those descendants goes too. Left listed elsewhere, the
  // deleted content came back under the other parent on every replica.
  const releaseElsewhere = (root: LogicalId): void => {
    const stack = [root];
    const seen = new Set<LogicalId>();
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      const shape = raw.node(node);
      if (!shape || shape.isText) continue;
      for (const child of shape.children) {
        if (reinserted.has(child) || registry.parentOf(child) !== node) continue;
        for (const lister of registry.listingParents(child)) {
          if (lister === node) continue;
          const other = raw.node(lister);
          const at = other && !other.isText ? other.children.indexOf(child) : -1;
          if (at < 0) continue;
          emit({
            kind: 'spliceChildren',
            parentLogicalId: lister,
            start: at,
            deleteCount: 1,
            childLogicalIds: [],
          });
        }
        stack.push(child);
      }
    }
  };
  // An adopted child is shown under the join survivor but listed under the tombstone it
  // came from. Before a journal addresses the survivor's children, list the adopted ones
  // where they are shown, so shared state holds the order the local edit was made against.
  // A part root can show members no parent lists, which the view adopted, in an order of its
  // own. The editor counts them, so before a journal addresses that root, its listing becomes
  // what it shows, and the journal's indexes land where its author saw them.
  const listedAsShown = new Set<LogicalId>();
  const listPartMembersAsShown = (parentId: LogicalId): void => {
    if (listedAsShown.has(parentId)) return;
    listedAsShown.add(parentId);
    const shown = shownPartChildren(parentId);
    const parent = raw.node(parentId);
    if (!shown || !parent || parent.isText) return;
    const listed = parent.children;
    if (shown.length === listed.length && shown.every((id, at) => listed[at] === id)) return;
    for (const id of shown) {
      if (listed.includes(id)) continue;
      for (const lister of registry.listingParents(id)) {
        const source = raw.node(lister);
        const at = source && !source.isText ? source.children.indexOf(id) : -1;
        if (at < 0 || lister === parentId) continue;
        emit({
          kind: 'spliceChildren',
          parentLogicalId: lister,
          start: at,
          deleteCount: 1,
          childLogicalIds: [],
        });
      }
    }
    const kept = listed.filter((id) => !shown.includes(id));
    emit({
      kind: 'spliceChildren',
      parentLogicalId: parentId,
      start: 0,
      deleteCount: listed.length,
      childLogicalIds: [...shown, ...kept],
    });
  };
  const listedWhereShown = new Set<LogicalId>();
  const listAdoptedWhereShown = (parentId: LogicalId): void => {
    if (listedWhereShown.has(parentId)) return;
    listedWhereShown.add(parentId);
    const parent = raw.node(parentId);
    if (!parent || parent.isText) return;
    // Hidden split losers move too. A losing copy listed before its winner is the slot the
    // winner shows in, so leaving it behind under the tombstone flipped the shown order of
    // the winner and the children between them as soon as the author edited the survivor.
    const adopted = registry
      .adoptedChildren(parentId)
      .filter((id) => !parent.children.includes(id));
    if (adopted.length === 0) return;
    for (const id of adopted) {
      for (const lister of registry.listingParents(id)) {
        if (registry.replacedByOf(lister) !== parentId) continue;
        const source = raw.node(lister);
        const at = source && !source.isText ? source.children.indexOf(id) : -1;
        if (at < 0) continue;
        emit({
          kind: 'spliceChildren',
          parentLogicalId: lister,
          start: at,
          deleteCount: 1,
          childLogicalIds: [],
        });
      }
    }
    emit({
      kind: 'spliceChildren',
      parentLogicalId: parentId,
      start: parent.children.length,
      deleteCount: 0,
      childLogicalIds: adopted,
    });
  };
  // The children a winning property container shows from its hidden copies, in shared state.
  const mergedCopiesOf = (containerId: LogicalId): LogicalId[] => {
    if (!MERGED_KINDS.has(kindOf(containerId) ?? '')) return [];
    const parentId = registry.parentOf(containerId);
    const parent = parentId ? raw.node(parentId) : null;
    if (!parentId || !parent || parent.isText) return [];
    const copies = visibleLayout(parentId, parent.children).companions.get(
      parent.children.indexOf(containerId)
    );
    return (copies ?? []).map((index) => parent.children[index]!);
  };
  const mergedChildrenOf = (containerId: LogicalId): LogicalId[] => {
    const out: LogicalId[] = [];
    for (const copyId of mergedCopiesOf(containerId)) {
      const copy = raw.node(copyId);
      if (copy && !copy.isText) out.push(...copy.children);
    }
    return out;
  };
  // A winning property container also shows the children of the copies a concurrent peer
  // wrote (`partitionWithMerges`). Before a journal addresses its children, list those where
  // they are shown, after its own, so the edit lands on the property its author saw.
  const mergedWhereShown = new Set<LogicalId>();
  const listMergedWhereShown = (containerId: LogicalId): void => {
    if (mergedWhereShown.has(containerId)) return;
    mergedWhereShown.add(containerId);
    const container = raw.node(containerId);
    if (!container || container.isText) return;
    const moved: LogicalId[] = [];
    for (const copyId of mergedCopiesOf(containerId)) {
      const copy = raw.node(copyId);
      if (!copy || copy.isText || copy.children.length === 0) continue;
      const children = [...copy.children];
      emit({
        kind: 'spliceChildren',
        parentLogicalId: copyId,
        start: 0,
        deleteCount: children.length,
        childLogicalIds: [],
      });
      for (const id of children) {
        if (!container.children.includes(id) && !moved.includes(id)) moved.push(id);
      }
    }
    if (moved.length === 0) return;
    emit({
      kind: 'spliceChildren',
      parentLogicalId: containerId,
      start: raw.node(containerId)!.children.length,
      deleteCount: 0,
      childLogicalIds: moved,
    });
  };
  const recording: SplitTextRecordingRegistry = {
    limits: registry.limits,
    projectedTextValue: (id) => (raw.node(id)?.isText ? text.value(id) : null),
    registerSplitText: (product, source, start, end) => text.register(product, source, start, end),
    splitTextPending: (id) => registry.splitTextPending(id),
    record: (id): SharedRecord | null => {
      const shape = raw.node(id);
      if (!shape) return null;
      if (shape.isText) return { logicalId: id, kind: 'textValue', value: text.value(id) };
      const descriptor = descriptors.get(id);
      const original = descriptor ? null : registry.record(id);
      if (original && original.kind !== 'textValue')
        return { ...original, childIds: shape.children };
      if (!descriptor || descriptor.kind === 'textValue') return null;
      return {
        logicalId: id,
        kind: descriptor.kind,
        namespaceUri: descriptor.qname.namespaceUri,
        localName: descriptor.qname.localName,
        prefix: descriptor.qname.prefix ?? '',
        attributes: [],
        bindings: [],
        childIds: shape.children,
      };
    },
  };
  const effects: SharedEffect[] = [];
  let refusal: ProjectionRefusal | null = null;
  const emit = (effect: SharedEffect): void => {
    if (refusal) return;
    const result = validateEffect(registry, effect, raw);
    if (result && !result.ok) {
      refusal = result;
      return;
    }
    effects.push(effect);
    projectEffect(raw, effect);
    if (effect.kind === 'spliceText') text.apply(effect);
  };
  try {
    for (const effect of incoming) {
      const result = validateEffect(registry, effect, visible);
      if (result && !result.ok) return result;
      projectEffect(visible, effect);
      if (effect.kind === 'putNode')
        descriptors.set(effect.descriptor.logicalId, effect.descriptor);
      if (effect.kind === 'spliceText') {
        const range = text.range(effect.logicalId);
        emit(
          range
            ? withProjectedTarget(
                {
                  ...effect,
                  logicalId: range.sourceId,
                  utf16Start: range.start + effect.utf16Start,
                },
                { logicalId: effect.logicalId, utf16Start: effect.utf16Start }
              )
            : effect
        );
      } else if (effect.kind === 'spliceChildren') {
        listPartMembersAsShown(effect.parentLogicalId);
        listAdoptedWhereShown(effect.parentLogicalId);
        listMergedWhereShown(effect.parentLogicalId);
        const parent = raw.node(effect.parentLogicalId);
        if (!parent || parent.isText) return { ok: false, code: 'invalid-bound' };
        const { positions, companions } = visibleLayout(effect.parentLogicalId, parent.children);
        const removed = positions
          .slice(effect.start, effect.start + effect.deleteCount)
          .map((index) => parent.children[index]!);
        if (effect.deleteCount === 0) {
          const ids = effect.childLogicalIds;
          emit({
            ...effect,
            start: insertionIndex(effect.parentLogicalId, parent.children, effect.start, ids),
          });
        } else {
          // Delete only visible entries. Hidden entries between them belong to another branch;
          // deleting the entire raw interval would alter that branch's undo history.
          const selected = positions.slice(effect.start, effect.start + effect.deleteCount);
          // Deleting a shown singleton deletes the copies it hid as well, or the next copy
          // would show the value this author just removed.
          const hiddenCopies = selected.flatMap((index) => companions.get(index) ?? []);
          if (hiddenCopies.length > 0 || permuted(positions)) {
            // A conflict hid copies, or moved a properties element out of shared order.
            // Delete from the highest index down, then insert where the range began.
            const doomed = [...selected, ...hiddenCopies].sort((left, right) => right - left);
            for (const index of doomed) {
              emit({ ...effect, start: index, deleteCount: 1, childLogicalIds: [] });
            }
            const after = raw.node(effect.parentLogicalId);
            if (effect.childLogicalIds.length > 0 && after && !after.isText) {
              const ids = effect.childLogicalIds;
              const at = insertionIndex(effect.parentLogicalId, after.children, effect.start, ids);
              emit({ ...effect, start: at, deleteCount: 0 });
            }
            selected.length = 0;
          }
          let end = selected.length;
          while (end > 0) {
            let first = end - 1;
            while (first > 0 && selected[first - 1] === selected[first]! - 1) first -= 1;
            emit({
              ...effect,
              start: selected[first]!,
              deleteCount: end - first,
              childLogicalIds: first === 0 ? effect.childLogicalIds : [],
            });
            end = first;
          }
        }
        // A deleted block takes what it showed with it, as a Yjs node takes its nested content.
        if (!refusal) {
          for (const id of removed) if (!reinserted.has(id)) releaseElsewhere(id);
        }
        if (!refusal && effect.childLogicalIds.length > 0) {
          for (const id of removed) {
            if (reinserted.has(id) && !descriptors.has(id)) continue;
            const products = splitProductsOf(kindOf(id), effect.childLogicalIds, kindOf);
            if (products) recordSplitTextSources(recording, id, products);
          }
        }
      } else if (effect.kind === 'moveNode') {
        // moveNode's destination index is measured AFTER unlinking the source.
        listPartMembersAsShown(effect.destinationParentLogicalId);
        listAdoptedWhereShown(effect.destinationParentLogicalId);
        listMergedWhereShown(effect.destinationParentLogicalId);
        const parent = raw.node(effect.destinationParentLogicalId);
        if (!parent || parent.isText) return { ok: false, code: 'invalid-bound' };
        const children = parent.children.filter((id) => id !== effect.logicalId);
        emit({
          ...effect,
          destinationIndex: insertionIndex(
            effect.destinationParentLogicalId,
            children,
            effect.destinationIndex,
            [effect.logicalId]
          ),
        });
      } else {
        emit(effect);
      }
      if (refusal) return refusal;
    }
    return { ok: true, journal: { effects }, plan: routed.plan };
  } finally {
    text.destroy();
  }
}
