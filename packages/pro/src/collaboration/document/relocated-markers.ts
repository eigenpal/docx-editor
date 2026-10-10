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
 * records the marker it replaced in the split lineage fields, and a paragraph shows only the
 * first copy of one lineage in its text (`inlineChildren`). Every replica reads the same text
 * order, so they keep the same copy, which is the one at the join.
 *
 * Only position markers take part. The split-dedup index, which decides concurrent run
 * splits, never indexes them (`relocatedMarkerRecord`), because a marker copy is never one of
 * its losers.
 */
import * as Y from 'yjs';
import {
  isRangeMarkerKind,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import {
  isElementRecord,
  isNodeMap,
  namespaceIdOf,
  NODE_SPLIT_FROM_FIELD,
  NODE_SPLIT_LINEAGE_FIELD,
  nodeRecordSplitLineage,
  readNodeShell,
} from './schema.ts';

const GENERIC_MARKERS = new Set(['proofErr', 'permStart', 'permEnd']);

/**
 * The markers that hold no content and only mark a position. A generic one counts only in
 * the WordprocessingML namespace, so a same-named element of another namespace never does.
 */
function isPositionMarker(kind: string, localName: string, inWml: boolean): boolean {
  if (kind === 'bookmarkStart' || kind === 'bookmarkEnd') return true;
  if (isRangeMarkerKind(kind as Parameters<typeof isRangeMarkerKind>[0])) return true;
  return kind === 'generic' && inWml && GENERIC_MARKERS.has(localName);
}

const WML_NAMESPACE_ID = namespaceIdOf(WML_NAMESPACE_URI);

/** Whether a shared record is a position marker, which the split-dedup index leaves out. */
export function relocatedMarkerRecord(record: unknown): boolean {
  if (!isNodeMap(record)) return false;
  const shell = readNodeShell(record as Y.Map<unknown>);
  return isPositionMarker(shell.kind, shell.localName, shell.namespaceId === WML_NAMESPACE_ID);
}

/** The marker a relocated copy replaced, or null for any other node. */
export function relocatedMarkerLineage(record: unknown): LogicalId | null {
  return relocatedMarkerRecord(record) ? nodeRecordSplitLineage(record) : null;
}

/** The attributes that tell two markers of one element apart. */
function identityOf(
  attributes: readonly { namespaceUri: string; localName: string; value: string }[]
) {
  const read = (localName: string) =>
    attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === localName)
      ?.value ?? null;
  return [read('id'), read('name')];
}

/** The nodes the plan's paragraphs hold, by id, for the attributes a record does not carry. */
function nodesOf(paragraphs: readonly OoxmlElement[]): Map<string, OoxmlElement> {
  const found = new Map<string, OoxmlElement>();
  const pending: OoxmlNode[] = [...paragraphs];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    found.set(node.id, node as OoxmlElement);
    for (const child of node.children) pending.push(child);
  }
  return found;
}

/**
 * Link each marker this journal embedded in a paragraph to the marker it removed with the
 * same element, `w:id` and `w:name`. An embedded node's attributes are written with its
 * paragraph's text, so they are read from the paragraphs the journal wrote. Linear in the
 * removed nodes and in those paragraphs.
 */
export function recordRelocatedMarkers(
  registry: DocumentRegistry,
  removed: readonly LogicalId[],
  embedded: ReadonlySet<string>,
  minted: ReadonlySet<string>,
  paragraphs: readonly OoxmlElement[]
): void {
  if (embedded.size === 0 || removed.length === 0) return;
  const removedByKey = new Map<string, LogicalId[]>();
  for (const id of removed) {
    const record = registry.record(id);
    if (!record || !isElementRecord(record) || record.childIds.length > 0) continue;
    if (!isPositionMarker(record.kind, record.localName, record.namespaceUri === WML_NAMESPACE_URI))
      continue;
    const key = JSON.stringify([record.kind, record.localName, ...identityOf(record.attributes)]);
    const list = removedByKey.get(key) ?? [];
    list.push(id);
    removedByKey.set(key, list);
  }
  if (removedByKey.size === 0) return;
  const written = nodesOf(paragraphs);
  for (const id of embedded) {
    if (!minted.has(id)) continue;
    const node = written.get(id);
    if (
      !node ||
      !isPositionMarker(node.kind, node.localName, node.namespaceUri === WML_NAMESPACE_URI)
    )
      continue;
    const key = JSON.stringify([node.kind, node.localName, ...identityOf(node.attributes)]);
    const source = removedByKey.get(key)?.shift();
    if (source === undefined) continue;
    const record = registry.schema.nodes.get(id);
    if (!isNodeMap(record)) continue;
    // A copy of a copy keeps the first marker as its lineage, as a split of a split does.
    const root = registry.splitLineageOf(source) ?? source;
    record.set(NODE_SPLIT_FROM_FIELD, root);
    record.set(NODE_SPLIT_LINEAGE_FIELD, root);
  }
}
