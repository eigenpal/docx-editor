/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { projectedTextTarget, sourceTargets } from './projected-text-target.ts';
import type {
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
} from '@docx-editor.dev/core/collaboration/replication';
import { validateEffect, type ApplyJournalResult } from './journal.ts';
import { JournalProjection, projectEffect } from './journal-projection.ts';
import { recordSplitTextSources, type SplitTextRecordingRegistry } from './split-text-recording.ts';
import { SplitTextSources, type SplitTextRange } from './split-text-sources.ts';
import { captureInsertionBoundary } from './split-text-boundaries.ts';
import { PACKAGE_NODES_KEY, NODE_TEXT_FIELD, makeTextRecord, type SharedRecord } from './schema.ts';
import type { DocumentRegistry } from './registry.ts';

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
      readonly effect: Extract<CanonicalPrimitiveEffect, { kind: 'spliceText' }>;
    }
  | {
      readonly kind: 'register';
      readonly product: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    };

/**
 * A single aliased keystroke needs only one range read. Compound edits can delete an anchor
 * and later insert into its old gap: numeric offset arithmetic cannot reproduce Yjs's deleted
 * item ordering. Lazily replay those uncommon journals against a disposable Yjs snapshot.
 */
class TextCoordinates {
  private readonly ranges = new Map<string, ProjectedRange | null>();
  private readonly histories = new Map<string, TextSplice[]>();
  private readonly strings = new Map<string, string>();
  private readonly actions: TextAction[] = [];
  private shadow: { doc: Y.Doc; nodes: Y.Map<Y.Map<unknown>>; sources: SplitTextSources } | null =
    null;

  constructor(
    private readonly registry: DocumentRegistry,
    private readonly raw: JournalProjection
  ) {}

  range(id: string): ProjectedRange | null {
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

  value(id: string): string {
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

  apply(effect: Extract<CanonicalPrimitiveEffect, { kind: 'spliceText' }>): void {
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

  register(product: string, source: string, start: number, end: number): void {
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
    const ensureText = (id: string): Y.Text => {
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
  private readonly filtered = new Set<string>();
  constructor(
    registry: DocumentRegistry,
    private readonly hidden: ReadonlySet<string>,
    private readonly raw: JournalProjection,
    private readonly text: TextCoordinates
  ) {
    super(registry);
  }
  override node(id: string): ReturnType<JournalProjection['node']> {
    const node = super.node(id);
    if (node && !this.filtered.has(id)) {
      this.filtered.add(id);
      node.children = node.children.filter((child) => !this.hidden.has(child));
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
 * Canonical journals address the visible tree. Concurrent split losers remain in Yjs for
 * undo, so their array entries must not shift a later edit onto a different run. Translate
 * against scratch trees in effect order. Validate before replaying either coordinate form:
 * scratch splices allocate too, so oversized input must reach the ordinary refusal path.
 */
export function projectJournalToShared(
  registry: DocumentRegistry,
  journal: CanonicalPrimitiveJournal
): { readonly ok: true; readonly journal: CanonicalPrimitiveJournal } | ProjectionRefusal {
  const hidden = registry.replacementLoserRuns();
  const minted = journal.effects.filter((effect) => effect.kind === 'putNode').length;
  if (registry.nodeCount() + minted > registry.limits.maxNodes) {
    return { ok: false, code: 'too-many-nodes' };
  }
  // Bound incoming lists before collecting future moves. Do not flatten unvalidated
  // child arrays into an additional unbounded allocation.
  const reinserted = new Set<string>();
  for (const effect of journal.effects) {
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
  const visible = new VisibleJournalProjection(registry, hidden, raw, text);
  const descriptors = new Map<
    string,
    Extract<CanonicalPrimitiveEffect, { kind: 'putNode' }>['descriptor']
  >();
  const kindOf = (id: string): string | null => descriptors.get(id)?.kind ?? registry.kindOf(id);
  const recording: SplitTextRecordingRegistry = {
    limits: registry.limits,
    projectedTextValue: (id) => (raw.node(id)?.isText ? text.value(id) : null),
    registerSplitText: (product, source, start, end) => text.register(product, source, start, end),
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
  const effects: CanonicalPrimitiveEffect[] = [];
  let refusal: ProjectionRefusal | null = null;
  const emit = (effect: CanonicalPrimitiveEffect): void => {
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
    for (const effect of journal.effects) {
      const result = validateEffect(registry, effect, visible);
      if (result && !result.ok) return result;
      projectEffect(visible, effect);
      if (effect.kind === 'putNode')
        descriptors.set(effect.descriptor.logicalId, effect.descriptor);
      if (effect.kind === 'spliceText') {
        const range = text.range(effect.logicalId);
        const mapped = range
          ? { ...effect, logicalId: range.sourceId, utf16Start: range.start + effect.utf16Start }
          : effect;
        if (range)
          sourceTargets.set(mapped, { logicalId: effect.logicalId, utf16Start: effect.utf16Start });
        emit(mapped);
      } else if (effect.kind === 'spliceChildren') {
        const parent = raw.node(effect.parentLogicalId);
        if (!parent || parent.isText) return { ok: false, code: 'invalid-bound' };
        const positions = parent.children.flatMap((id, index) => (hidden.has(id) ? [] : [index]));
        const removed = positions
          .slice(effect.start, effect.start + effect.deleteCount)
          .map((index) => parent.children[index]!);
        const start = positions[effect.start] ?? parent.children.length;
        if (effect.deleteCount === 0) {
          emit({ ...effect, start });
        } else {
          // Delete only visible entries. Hidden entries between them belong to another branch;
          // deleting the entire raw interval would alter that branch's undo history.
          const selected = positions.slice(effect.start, effect.start + effect.deleteCount);
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
        if (!refusal && effect.childLogicalIds.length > 0) {
          const runs = effect.childLogicalIds.filter((id) => kindOf(id) === 'run');
          for (const id of removed)
            if (kindOf(id) === 'run' && (!reinserted.has(id) || descriptors.has(id)))
              recordSplitTextSources(recording, id, runs);
        }
      } else if (effect.kind === 'moveNode') {
        // moveNode's destination index is measured AFTER unlinking the source.
        const parent = raw.node(effect.destinationParentLogicalId);
        if (!parent || parent.isText) return { ok: false, code: 'invalid-bound' };
        const children = parent.children.filter((id) => id !== effect.logicalId);
        const positions = children.flatMap((id, index) => (hidden.has(id) ? [] : [index]));
        emit({
          ...effect,
          destinationIndex: positions[effect.destinationIndex] ?? children.length,
        });
      } else {
        emit(effect);
      }
      if (refusal) return refusal;
    }
    return { ok: true, journal: { effects } };
  } finally {
    text.destroy();
  }
}
