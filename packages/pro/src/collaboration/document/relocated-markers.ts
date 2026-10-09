/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Position markers that an edit moves from between paragraphs into a paragraph's text.
 *
 * Accepting a deletion that joins two paragraphs moves a bookmark or comment boundary that
 * stood between them into the joined paragraph, as a new node. Two participants who accept
 * the same join at once each write their own copy, so the merged text holds both. Each copy
 * records the marker it replaced as its split lineage, and a paragraph shows only the first
 * copy of one lineage in its text (`inlineChildren`). Every replica reads the same text
 * order, so they keep the same copy, which is the one at the join.
 */
import { isRangeMarkerKind, WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { isElementRecord } from './schema.ts';

/** The markers that hold no content and only mark a position. */
function isPositionMarker(kind: string, namespaceUri: string, localName: string): boolean {
  if (kind === 'bookmarkStart' || kind === 'bookmarkEnd') return true;
  if (isRangeMarkerKind(kind as Parameters<typeof isRangeMarkerKind>[0])) return true;
  return (
    kind === 'generic' &&
    namespaceUri === WML_NAMESPACE_URI &&
    (localName === 'proofErr' || localName === 'permStart' || localName === 'permEnd')
  );
}

/**
 * One marker's element, or null for anything else. Attributes are not compared: an embedded
 * node's attributes live in its paragraph's shared text, not on its record. The markers of one
 * join keep their order, so pairing them in order pairs each copy with its source.
 */
function markerKey(registry: DocumentRegistry, id: LogicalId): string | null {
  const record = registry.record(id);
  if (!record || !isElementRecord(record) || record.childIds.length > 0) return null;
  if (!isPositionMarker(record.kind, record.namespaceUri, record.localName)) return null;
  return JSON.stringify([record.kind, record.namespaceUri, record.localName]);
}

/**
 * Link each marker this journal embedded in a paragraph to a marker of the same element it
 * removed, in order. Linear in the removed and embedded nodes.
 */
export function recordRelocatedMarkers(
  registry: DocumentRegistry,
  removed: readonly LogicalId[],
  embedded: ReadonlySet<string>,
  minted: ReadonlySet<string>
): void {
  if (embedded.size === 0 || removed.length === 0) return;
  const removedByKey = new Map<string, LogicalId[]>();
  for (const id of removed) {
    const key = markerKey(registry, id);
    if (key === null) continue;
    const list = removedByKey.get(key) ?? [];
    list.push(id);
    removedByKey.set(key, list);
  }
  if (removedByKey.size === 0) return;
  for (const id of embedded) {
    if (!minted.has(id)) continue;
    const key = markerKey(registry, id as LogicalId);
    const source = key === null ? undefined : removedByKey.get(key)?.shift();
    if (source === undefined) continue;
    // A copy of a copy keeps the first marker as its lineage, as a split of a split does.
    const root = registry.splitLineageOf(source) ?? source;
    registry.recordRunSplit(root, source, [id as LogicalId]);
  }
}
