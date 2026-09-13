/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { CollaborationSchemaError } from '../schema.ts';
import { rejectDangerousKey, type DocumentLimits } from './limits.ts';
import { isNodeMap, NODE_TEXT_FIELD } from './schema.ts';

/** A split's text retains the source character identities; copies are only serialization shells. */
export const NODE_SPLIT_TEXT_SOURCE_FIELD = 'splitTextSource';

const RESTORED_ANCHORS_ORIGIN = Object.freeze({ kind: 'docx-package-restored-split-anchors' });

interface SourceSpan {
  readonly sourceId: string;
  readonly start: Y.RelativePosition;
  readonly end: Y.RelativePosition;
}

export interface SplitTextRange {
  readonly sourceId: string;
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
export class SplitTextSources {
  private readonly sourceByAlias = new Map<string, string>();
  private readonly aliasesBySource = new Map<string, Set<string>>();
  private readonly pending = new Set<string>();
  private readonly values = new Map<string, string>();

  constructor(
    private readonly nodes: Y.Map<Y.Map<unknown>>,
    private readonly doc: Y.Doc,
    private readonly limits: Pick<DocumentLimits, 'maxTextLength' | 'maxStringLength'>
  ) {}

  /** Flatten nesting when written; reads never chase peer-controlled alias chains. */
  register(productTextId: string, sourceTextId: string, start: number, end: number): void {
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
      let target = original;
      let item = Y.getItem(this.doc.store, target);
      // `redone` is local UndoManager metadata, never decoded from peer-written fields.
      while (item instanceof Y.Item && item.redone !== null) {
        target = Y.createID(item.redone.client, item.redone.clock + target.clock - item.id.clock);
        item = Y.getItem(this.doc.store, target);
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
    const writes: { readonly id: string; readonly encoded: string }[] = [];
    for (const id of this.sourceByAlias.keys()) {
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

  sourceAliases(sourceId: string): readonly string[] {
    return [...(this.aliasesBySource.get(sourceId) ?? [])];
  }

  range(id: string): SplitTextRange | null {
    const span = this.read(id);
    return span === null ? null : this.resolve(span);
  }

  value(id: string): string | null {
    const range = this.range(id);
    return range === null ? null : range.text.toString().slice(range.start, range.end);
  }

  indexExisting(id: string): void {
    const span = this.read(id);
    // Resolve now too: malformed references must not become a silent fallback to copied text.
    if (span) this.resolve(span);
    const previous = this.sourceByAlias.get(id);
    if (previous !== undefined && previous !== span?.sourceId) {
      const aliases = this.aliasesBySource.get(previous);
      aliases?.delete(id);
      if (aliases?.size === 0) this.aliasesBySource.delete(previous);
      this.sourceByAlias.delete(id);
    }
    if (span) {
      this.sourceByAlias.set(id, span.sourceId);
      const aliases = this.aliasesBySource.get(span.sourceId) ?? new Set<string>();
      aliases.add(id);
      this.aliasesBySource.set(span.sourceId, aliases);
    }
    if (span || previous !== undefined || this.values.has(id)) this.pending.add(id);
  }

  noteChanged(id: string): void {
    this.indexExisting(id);
    for (const alias of this.aliasesBySource.get(id) ?? []) this.pending.add(alias);
  }

  reset(): void {
    this.sourceByAlias.clear();
    this.aliasesBySource.clear();
    // Keep values until overlays reports removals, so an incremental caller invalidates them.
    for (const id of this.values.keys()) this.pending.add(id);
    this.nodes.forEach((_record, id) => this.indexExisting(id));
  }

  overlays(): {
    readonly values: ReadonlyMap<string, string>;
    readonly changedIds: ReadonlySet<string>;
  } {
    const changedIds = new Set<string>();
    const sourceValues = new Map<string, string>();
    for (const id of this.pending) {
      const range = this.range(id);
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
    return { values: this.values, changedIds };
  }

  private sourceText(id: string): Y.Text {
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

  private read(id: string): SourceSpan | null {
    const record = this.nodes.get(id);
    if (!isNodeMap(record) || !record.has(NODE_SPLIT_TEXT_SOURCE_FIELD)) return null;
    const encoded = record.get(NODE_SPLIT_TEXT_SOURCE_FIELD);
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
    return { sourceId: data.sourceId, start: position(data.start), end: position(data.end) };
  }

  private resolve(span: SourceSpan): SplitTextRange {
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
    if (
      start === null ||
      end === null ||
      start.type !== text ||
      end.type !== text ||
      start.index < 0 ||
      end.index < start.index ||
      end.index > text.length
    ) {
      return invalid('invalid-bound', span.sourceId);
    }
    return {
      sourceId: span.sourceId,
      text,
      start: start.index,
      end: end.index,
      startAssoc: span.start.assoc,
      endAssoc: span.end.assoc,
      startAnchorDeleted:
        span.start.item !== null && Y.getItem(this.doc.store, span.start.item).deleted,
      endAnchorDeleted: span.end.item !== null && Y.getItem(this.doc.store, span.end.item).deleted,
    };
  }
}
