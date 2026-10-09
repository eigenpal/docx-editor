/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Which embedded nodes count as copies of a relocated position marker.
import * as Y from 'yjs';
import { expect, test } from 'bun:test';
import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { asLogicalId, type LogicalId } from '../document/identity.ts';
import type { DocumentRegistry } from '../document/registry.ts';
import {
  recordRelocatedMarkers,
  relocatedMarkerLineage,
  relocatedMarkerRecord,
} from '../document/relocated-markers.ts';
import {
  NODE_SHELL_FIELD,
  NODE_SPLIT_FROM_FIELD,
  NODE_SPLIT_LINEAGE_FIELD,
  nodeRecordSplitLineage,
  packNodeShell,
} from '../document/schema.ts';
import { SplitDedupIndex } from '../document/split-dedup.ts';

const attribute = (localName: string, value: string) => ({
  namespaceUri: WML_NAMESPACE_URI,
  localName,
  prefix: 'w',
  value,
});

function bookmark(id: string, markerId: string, name: string): OoxmlElement {
  return {
    id,
    kind: 'bookmarkStart',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'bookmarkStart',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [attribute('id', markerId), attribute('name', name)],
    children: [],
  } as unknown as OoxmlElement;
}

/** Shared node records, and the registry reads the link uses. */
function setup() {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  const put = (id: string, kind: string, localName: string) => {
    const record = new Y.Map<unknown>();
    nodes.set(id, record);
    record.set(NODE_SHELL_FIELD, packNodeShell(kind, 'w', localName, 'w'));
    return record;
  };
  const source = {
    logicalId: asLogicalId('source'),
    kind: 'bookmarkStart',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'bookmarkStart',
    attributes: [attribute('id', '1'), attribute('name', 'b1')],
    bindings: [],
    childIds: [],
  };
  const registry = {
    schema: { nodes },
    record: (id: LogicalId) => (id === 'source' ? source : null),
    splitLineageOf: () => null,
  } as unknown as DocumentRegistry;
  return { doc, nodes, put, registry };
}

test('a copy with the same w:id and w:name is linked to the marker it replaced', () => {
  const { doc, put, registry } = setup();
  doc.transact(() => {
    const copy = put('copy', 'bookmarkStart', 'bookmarkStart');
    recordRelocatedMarkers(
      registry,
      [asLogicalId('source')],
      new Set(['copy']),
      new Set(['copy']),
      [
        { ...bookmark('p', '', ''), kind: 'paragraph', children: [bookmark('copy', '1', 'b1')] },
      ] as unknown as OoxmlElement[]
    );
    expect(nodeRecordSplitLineage(copy)).toBe(asLogicalId('source'));
  });
});

test('a different marker of the same element is never linked as a copy', () => {
  const { doc, put, registry } = setup();
  doc.transact(() => {
    const other = put('other', 'bookmarkStart', 'bookmarkStart');
    recordRelocatedMarkers(
      registry,
      [asLogicalId('source')],
      new Set(['other']),
      new Set(['other']),
      [
        { ...bookmark('p', '', ''), kind: 'paragraph', children: [bookmark('other', '2', 'b2')] },
      ] as unknown as OoxmlElement[]
    );
    expect(nodeRecordSplitLineage(other)).toBeNull();
  });
});

test('only position markers read as relocated copies, and the split index leaves them out', () => {
  const { doc, nodes, put } = setup();
  doc.transact(() => {
    for (const [id, kind, localName] of [
      ['marker', 'bookmarkStart', 'bookmarkStart'],
      ['tab', 'tab', 'tab'],
      ['run', 'run', 'r'],
    ] as const) {
      const record = put(id, kind, localName);
      record.set(NODE_SPLIT_FROM_FIELD, 'origin');
      record.set(NODE_SPLIT_LINEAGE_FIELD, 'origin');
    }
  });
  expect(relocatedMarkerLineage(nodes.get('marker'))).toBe(asLogicalId('origin'));
  expect(relocatedMarkerLineage(nodes.get('tab'))).toBeNull();
  expect(relocatedMarkerLineage(nodes.get('run'))).toBeNull();
  expect(relocatedMarkerRecord(nodes.get('marker'))).toBe(true);
  // A marker copy shares the split fields but never becomes a split loser to recompute.
  const index = new SplitDedupIndex(nodes);
  index.indexExisting(asLogicalId('marker'));
  index.indexExisting(asLogicalId('run'));
  const products = (index as unknown as { runsBySplitOrigin: Map<string, Set<string>> })
    .runsBySplitOrigin;
  expect([...(products.get('origin') ?? [])]).toEqual(['run']);
});
