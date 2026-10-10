/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { CollaborationSchemaError } from '../errors.ts';
import { rejectDangerousKey, type DocumentLimits } from './limits.ts';
import { asLogicalId, type LogicalId } from './identity.ts';
import { hasPendingUpdates, isNodeMap, mapFieldPending, NODE_TEXT_FIELD } from './schema.ts';

/** A split's text retains the source character identities; copies are only serialization shells. */
export const NODE_SPLIT_TEXT_SOURCE_FIELD = 'splitTextSource';

const RESTORED_ANCHORS_ORIGIN = Object.freeze({ kind: 'docx-package-restored-split-anchors' });

interface SourceSpan {
  readonly sourceId: LogicalId;
  readonly start: Y.RelativePosition;
  readonly end: Y.RelativePosition;
}

export interface SplitTextRange {
  readonly sourceId: LogicalId;
  readonly text: Y.Text;
  readonly start: number;
  readonly end: number;
  readonly startAssoc: number;
  readonly endAssoc: number;
  readonly startAnchorDeleted: boolean;
  readonly endAnchorDeleted: boolean;
}

function invalid(code: 'invalid-string' | 'invalid-bound', detail: string): never {
  throw new CollaborationSchemaError(code, detail);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown): boolean {
  return (
    object(value) &&
    Object.keys(value).every((key) => key === 'client' || key === 'clock') &&
    Number.isSafeInteger(value.client) &&
    (value.client as number) >= 0 &&
    Number.isSafeInteger(value.clock) &&
    (value.clock as number) >= 0
  );
}

function position(value: unknown): Y.RelativePosition {
  if (
    !object(value) ||
    !Object.keys(value).every((key) => ['type', 'item', 'assoc'].includes(key)) ||
    !validId(value.type) ||
    (value.item !== undefined && !validId(value.item)) ||
    (value.assoc !== 0 && value.assoc !== -1)
  ) {
    return invalid('invalid-string', NODE_SPLIT_TEXT_SOURCE_FIELD);
  }
  return Y.createRelativePositionFromJSON(value);
}

/** Derived source slices, invalidated only when a source or one of its aliases changes. */
/**
 * A reference whose source has not reached this replica yet.
 *
 * Yjs keeps an update whose dependencies are missing as pending, and integrates it when they
 * arrive. A split reference is the same at this level: a peer can receive the slice before the
 * source text it slices, or before the characters its boundaries name. That is not malformed
 * shared state, so it is not refused: the alias shows nothing until the source arrives, and
 * the source's arrival re-reads it.
 */
class AwaitingSource extends Error {}

export class SplitTextSources {
  private readonly sourceByAlias = new Map<LogicalId, LogicalId>();
  private readonly aliasesBySource = new Map<LogicalId, Set<LogicalId>>();
  private readonly pending = new Set<LogicalId>();
  private readonly values = new Map<LogicalId, string>();
  /** Aliases whose source or boundary characters have not arrived. They show no text. */
  private readonly awaiting = new Set<LogicalId>();
  /** The last alias value each id parsed, for the window a peer's rewrite is in flight. */
  private readonly lastEncoded = new Map<LogicalId, string>();
  /** Aliases showing a held value. Once no update is pending they are read again, because a
   *  removal seen while unrelated updates were pending was real, not an overwrite. */
  private readonly held = new Set<LogicalId>();

  constructor(
    private readonly nodes: Y.Map<Y.Map<unknown>>,
    private readonly doc: Y.Doc,
    private readonly limits: Pick<DocumentLimits, 'maxTextLength' | 'maxStringLength'>
  ) {}

  /** Whether a text node neither slices another text nor is sliced by one. */
  isPlain(id: LogicalId): boolean {
    return !this.sourceByAlias.has(id) && !this.aliasesBySource.has(id);
  }

  /** Flatten nesting when written; reads never chase peer-controlled alias chains. */
  register(productTextId: LogicalId, sourceTextId: LogicalId, start: number, end: number): void {
    const product = this.nodes.get(productTextId);
    if (!isNodeMap(product) || !(product.get(NODE_TEXT_FIELD) instanceof Y.Text)) {
      invalid('invalid-bound', productTextId);
    }
    const inherited = this.read(sourceTextId);
    const range =
      inherited === null
        ? {
            sourceId: sourceTextId,
            text: this.sourceText(sourceTextId),
            start: 0,
            end: this.sourceText(sourceTextId).length,
          }
        : this.resolve(inherited);
    if (
      range.sourceId.length === 0 ||
      range.sourceId.length > this.limits.maxStringLength ||
      rejectDangerousKey(range.sourceId)
    )
      invalid('invalid-string', sourceTextId);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > range.end - range.start ||
      productTextId === range.sourceId
    ) {
      invalid('invalid-bound', productTextId);
    }
    const boundary = (offset: number, edge: 'start' | 'end'): Y.RelativePosition => {
      if (inherited && edge === 'end' && offset === range.end - range.start) return inherited.end;
      if (inherited && offset === 0) return inherited.start;
      if (inherited && offset === range.end - range.start) return inherited.end;
      // Every internal boundary associates with the following character. Sharing that
      // position makes a boundary insertion belong to the left slice exactly once.
      const at = range.start + offset;
      return Y.createRelativePositionFromTypeIndex(
        range.text,
        at,
        at === 0 && edge === 'start' ? -1 : 0
      );
    };
    const encoded = JSON.stringify({
      sourceId: range.sourceId,
      start: Y.relativePositionToJSON(boundary(start, 'start')),
      end: Y.relativePositionToJSON(boundary(end, 'end')),
    });
    if (encoded.length > this.limits.maxStringLength) invalid('invalid-string', productTextId);
    product.set(NODE_SPLIT_TEXT_SOURCE_FIELD, encoded);
    this.indexExisting(productTextId);
  }

  /**
   * Yjs keeps an undone character's `redone` link only on the authoring replica. Publish
   * those restored identities so existing peers and cold joins retain the same formatting
   * boundaries. This is derived metadata, outside the user's undo history.
   *
   * Do not replace an anchor whose final character is still deleted: its collapsed offset
   * carries no information about the original run boundary, and the next undo needs that
   * character identity to recover the partition.
   */
  normalizeRestoredAnchors(): void {
    const normalized = new Map<string, Y.RelativePosition>();
    const restore = (endpoint: Y.RelativePosition): Y.RelativePosition => {
      const original = endpoint.item;
      if (original === null) return endpoint;
      const key = `${original.client}:${original.clock}:${endpoint.assoc}`;
      const cached = normalized.get(key);
      if (cached) return cached;
      // An id this replica has not integrated yet is pending, as Yjs treats it: `getItem`
      // assumes the id exists and throws inside Yjs when it does not, which an undo reached
      // with an anchor or a redo target still in flight from a peer.
      const itemAt = (id: Y.ID) =>
        Y.getState(this.doc.store, id.client) > id.clock ? Y.getItem(this.doc.store, id) : null;
      let target = original;
      let item = itemAt(target);
      // `redone` is local UndoManager metadata, never decoded from peer-written fields.
      while (item instanceof Y.Item && item.redone !== null) {
        target = Y.createID(item.redone.client, item.redone.clock + target.clock - item.id.clock);
        item = itemAt(target);
      }
      const next =
        item instanceof Y.Item && !item.deleted && !Y.compareIDs(original, target)
          ? Y.createRelativePositionFromJSON({
              ...Y.relativePositionToJSON(endpoint),
              item: { client: target.client, clock: target.clock },
            })
          : endpoint;
      normalized.set(key, next);
      return next;
    };
    const writes: { readonly id: LogicalId; readonly encoded: string }[] = [];
    for (const id of this.sourceByAlias.keys()) {
      // A peer's rewrite is in flight: writing the last read boundaries would overwrite it.
      const record = this.nodes.get(id);
      if (isNodeMap(record) && mapFieldPending(record, NODE_SPLIT_TEXT_SOURCE_FIELD)) continue;
      const span = this.read(id);
      if (!span) continue;
      const start = restore(span.start);
      const end = restore(span.end);
      if (
        Y.compareRelativePositions(start, span.start) &&
        Y.compareRelativePositions(end, span.end)
      )
        continue;
      const encoded = JSON.stringify({
        sourceId: span.sourceId,
        start: Y.relativePositionToJSON(start),
        end: Y.relativePositionToJSON(end),
      });
      if (encoded.length > this.limits.maxStringLength) invalid('invalid-string', id);
      writes.push({ id, encoded });
    }
    if (writes.length === 0) return;
    this.doc.transact(() => {
      for (const { id, encoded } of writes) {
        this.nodes.get(id)!.set(NODE_SPLIT_TEXT_SOURCE_FIELD, encoded);
        this.indexExisting(id);
      }
    }, RESTORED_ANCHORS_ORIGIN);
  }

  sourceAliases(sourceId: LogicalId): readonly LogicalId[] {
    return [...(this.aliasesBySource.get(sourceId) ?? [])];
  }

  /** The resolved slice, or null for a node that is no alias or whose source has not arrived. */
  range(id: LogicalId): SplitTextRange | null {
    try {
      return this.resolveRange(id);
    } catch (error) {
      if (error instanceof AwaitingSource) return null;
      throw error;
    }
  }

  /** Whether this node is an alias whose source or boundary has not integrated yet. */
  isPending(id: LogicalId): boolean {
    try {
      this.resolveRange(id);
      return false;
    } catch (error) {
      if (error instanceof AwaitingSource) return true;
      throw error;
    }
  }

  private resolveRange(id: LogicalId): SplitTextRange | null {
    const span = this.read(id);
    return span === null ? null : this.resolve(span);
  }

  value(id: LogicalId): string | null {
    const range = this.range(id);
    return range === null ? null : range.text.toString().slice(range.start, range.end);
  }

  indexExisting(id: LogicalId): void {
    // This runs inside a Yjs observer, and a throw there escapes `applyUpdate` into the
    // provider's message handler and the host's error reporting. A reference that fails is
    // left pending instead: the next materialize reads it again, refuses it there, and the
    // session reports the refusal as its status. Malformed references still never become a
    // silent fallback to copied text.
    let span: SourceSpan | null = null;
    let refused = false;
    try {
      span = this.read(id);
      if (span) this.resolve(span);
    } catch {
      // An unreadable reference drops its old alias below; an unresolvable one keeps the new
      // alias indexed, so the source's arrival or repair re-reads it.
      refused = true;
    }
    const previous = this.sourceByAlias.get(id);
    if (previous !== undefined && previous !== span?.sourceId) {
      const aliases = this.aliasesBySource.get(previous);
      aliases?.delete(id);
      if (aliases?.size === 0) this.aliasesBySource.delete(previous);
      this.sourceByAlias.delete(id);
    }
    if (span) {
      this.sourceByAlias.set(id, span.sourceId);
      const aliases = this.aliasesBySource.get(span.sourceId) ?? new Set<LogicalId>();
      aliases.add(id);
      this.aliasesBySource.set(span.sourceId, aliases);
    }
    if (refused || span || previous !== undefined || this.values.has(id)) this.pending.add(id);
  }

  noteChanged(id: LogicalId): void {
    this.indexExisting(id);
    for (const alias of this.aliasesBySource.get(id) ?? []) this.pending.add(alias);
  }

  reset(): void {
    this.sourceByAlias.clear();
    this.aliasesBySource.clear();
    // Keep values until overlays reports removals, so an incremental caller invalidates them.
    for (const id of this.values.keys()) this.pending.add(id);
    this.nodes.forEach((_record, id) => this.indexExisting(asLogicalId(id)));
  }

  overlays(): {
    readonly values: ReadonlyMap<LogicalId, string>;
    readonly changedIds: ReadonlySet<LogicalId>;
    readonly awaiting: ReadonlySet<LogicalId>;
  } {
    const changedIds = new Set<LogicalId>();
    const sourceValues = new Map<LogicalId, string>();
    if (this.held.size > 0 && !hasPendingUpdates(this.doc)) {
      for (const id of this.held) this.indexExisting(id);
      this.held.clear();
    }
    for (const id of this.pending) {
      let range: SplitTextRange | null = null;
      try {
        range = this.resolveRange(id);
        if (this.awaiting.delete(id)) changedIds.add(id);
      } catch (error) {
        if (!(error instanceof AwaitingSource)) throw error;
        if (!this.awaiting.has(id)) changedIds.add(id);
        this.awaiting.add(id);
      }
      let value: string | null = null;
      if (range) {
        let source = sourceValues.get(range.sourceId);
        if (source === undefined) {
          source = range.text.toString();
          sourceValues.set(range.sourceId, source);
        }
        value = source.slice(range.start, range.end);
      }
      if (value === null) {
        if (this.values.delete(id)) changedIds.add(id);
      } else if (value !== this.values.get(id)) {
        this.values.set(id, value);
        changedIds.add(id);
      }
    }
    this.pending.clear();
    return { values: this.values, changedIds, awaiting: this.awaiting };
  }

  private sourceText(id: LogicalId): Y.Text {
    const record = this.nodes.get(id);
    const text = isNodeMap(record) ? record.get(NODE_TEXT_FIELD) : null;
    if (
      !(text instanceof Y.Text) ||
      text.doc !== this.doc ||
      text.length > this.limits.maxTextLength
    ) {
      return invalid('invalid-bound', id);
    }
    return text;
  }

  private read(id: LogicalId): SourceSpan | null {
    const record = this.nodes.get(id);
    if (!isNodeMap(record)) return null;
    // An alias stays an alias: nothing removes this field, only overwrites it. A removed value
    // with no live one is a peer's rewrite whose new value has not integrated yet. Reading it
    // as a plain text node let a local split build an alias on top of this alias. Until the
    // new value arrives, the last value this replica read still holds: the text stays on
    // screen, and a split flattens onto known boundaries. With no earlier read, it is pending.
    let encoded: unknown;
    if (mapFieldPending(record, NODE_SPLIT_TEXT_SOURCE_FIELD)) {
      encoded = this.lastEncoded.get(id);
      if (encoded === undefined) throw new AwaitingSource(id);
      this.held.add(id);
    } else {
      if (!record.has(NODE_SPLIT_TEXT_SOURCE_FIELD)) return null;
      encoded = record.get(NODE_SPLIT_TEXT_SOURCE_FIELD);
    }
    if (typeof encoded !== 'string' || encoded.length > this.limits.maxStringLength) {
      return invalid('invalid-string', id);
    }
    let data: unknown;
    try {
      data = JSON.parse(encoded);
    } catch {
      return invalid('invalid-string', id);
    }
    if (
      !object(data) ||
      !Object.keys(data).every((key) => ['sourceId', 'start', 'end'].includes(key)) ||
      typeof data.sourceId !== 'string' ||
      data.sourceId.length === 0 ||
      data.sourceId.length > this.limits.maxStringLength ||
      rejectDangerousKey(data.sourceId) ||
      data.sourceId === id
    )
      return invalid('invalid-string', id);
    if (!(record.get(NODE_TEXT_FIELD) instanceof Y.Text)) return invalid('invalid-bound', id);
    const span = {
      sourceId: asLogicalId(data.sourceId),
      start: position(data.start),
      end: position(data.end),
    };
    this.lastEncoded.set(id, encoded);
    return span;
  }

  private resolve(span: SourceSpan): SplitTextRange {
    // Missing pieces are pending, as in Yjs: the source record, or a boundary character not
    // integrated yet. Everything below them is a malformed reference and is refused.
    if (
      !this.nodes.has(span.sourceId) ||
      [span.start, span.end].some(
        (endpoint) =>
          endpoint.item !== null &&
          Y.getState(this.doc.store, endpoint.item.client) <= endpoint.item.clock
      )
    ) {
      throw new AwaitingSource(span.sourceId);
    }
    const record = this.nodes.get(span.sourceId);
    if (isNodeMap(record) && record.has(NODE_SPLIT_TEXT_SOURCE_FIELD)) {
      return invalid('invalid-bound', span.sourceId);
    }
    const text = this.sourceText(span.sourceId);
    const typeId = Y.createRelativePositionFromTypeIndex(text, 0).type;
    if (
      !typeId ||
      [span.start, span.end].some(
        (endpoint) =>
          endpoint.type?.client !== typeId.client || endpoint.type?.clock !== typeId.clock
      )
    ) {
      return invalid('invalid-bound', span.sourceId);
    }
    const start = Y.createAbsolutePositionFromRelativePosition(span.start, this.doc, false);
    const end = Y.createAbsolutePositionFromRelativePosition(span.end, this.doc, false);
    const startAnchorDeleted =
      span.start.item !== null && Y.getItem(this.doc.store, span.start.item).deleted;
    const endAnchorDeleted =
      span.end.item !== null && Y.getItem(this.doc.store, span.end.item).deleted;
    if (
      start === null ||
      end === null ||
      start.type !== text ||
      end.type !== text ||
      start.index < 0 ||
      end.index > text.length
    ) {
      return invalid('invalid-bound', span.sourceId);
    }
    // An inverted range is valid shared state, and every replica reads the same indexes, so it
    // is an empty slice (the `Math.max` below). A deleted anchor resolves where its character
    // was, so text typed there later lands between it and a live anchor; and undo restores
    // characters as new items, which can carry two live anchors past each other. Refusing
    // that range ended sessions and stopped a late joiner from opening the room.
    return {
      sourceId: span.sourceId,
      text,
      start: start.index,
      end: Math.max(start.index, end.index),
      startAssoc: span.start.assoc,
      endAssoc: span.end.assoc,
      startAnchorDeleted,
      endAnchorDeleted,
    };
  }
}
