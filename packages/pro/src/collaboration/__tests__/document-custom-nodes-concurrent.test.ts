/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent first-create of `/customXml/item1.xml` is the comments.xml race:
// `putXmlPart` is last-write-wins, so one replica's data-part root vanishes and its
// `node` children become unreachable. A silently dropped custom node cannot be
// reconciled. These tests refuse that outcome.

import { describe, expect, test } from 'bun:test';
import {
  contentControlPropertiesOf,
  contentControlsIn,
  findCustomXmlDataPart,
  insertPackageCustomNode,
  readCustomXmlNode,
  TreePackageStore,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import {
  createCollaborationDocumentPort,
  type CanonicalPrimitiveJournal,
} from '@docx-editor.dev/core/collaboration';
import { LogicalIdentityMap } from '../document-identity.ts';
import { zipDocument } from './document-peer-support.ts';
import {
  applyJournal,
  concurrent,
  destroyReplica,
  joinReplica,
  loadPackage,
  mainPart,
  packageFingerprint,
  packageOf,
  saveReopenDigest,
  seedReplica,
  walk,
  type Replica,
} from './document-support.ts';

const NS = 'https://example.test/nodes';
const NS_OTHER = 'https://example.test/other-nodes';
const ROOT = 'nodes';
const DATA = JSON.stringify({ sourceId: 'src_9f3', year: 2024 });
const ALICE_REPLICA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB_REPLICA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function emptyBytes(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>Before after</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Third</w:t></w:r></w:p>' +
      '<w:sectPr/>'
  );
}

function paragraphIdAt(pkg: OoxmlPackage, index: number): string {
  const paragraphs: string[] = [];
  walk(mainPart(pkg).root, (node) => {
    if (node.kind === 'paragraph') paragraphs.push(node.id);
  });
  const id = paragraphs[index];
  if (!id) throw new Error(`no paragraph at ${index}`);
  return id;
}

function captureInsert(
  pkg: OoxmlPackage,
  nodeId: string,
  paragraphIndex: number,
  offset: number,
  namespaceUri = NS
): CanonicalPrimitiveJournal {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('missing main part');
  const store = new TreePackageStore(pkg, main);
  const port = createCollaborationDocumentPort(store, { documentId: 'custom-xml-capture' });
  let journal: CanonicalPrimitiveJournal | null = null;
  const stop = port.observePrimitiveJournal((next) => {
    journal = next;
  });
  const result = insertPackageCustomNode(store, {
    paragraphId: paragraphIdAt(pkg, paragraphIndex),
    offset,
    tag: 'acme:citation',
    text: `(${nodeId})`,
    lock: 'contentLocked',
    payload: {
      namespaceUri,
      rootLocalName: ROOT,
      nodeId,
      label: `(${nodeId})`,
      data: DATA,
    },
  });
  port.flushPendingJournals();
  stop();
  if (!result.ok) throw new Error(String(result.reason));
  if (!journal) throw new Error('insert recorded no journal');
  return journal;
}

function applyTranslated(replica: Replica, journal: CanonicalPrimitiveJournal): void {
  const identity = new LogicalIdentityMap(
    (id) => replica.registry.hasNode(id),
    replica.mint.replicaId
  );
  applyJournal(replica, identity.translate(journal));
}

function expectBoundNode(pkg: OoxmlPackage, nodeId: string, namespaceUri = NS): void {
  const dataPart = findCustomXmlDataPart(pkg, pkg.mainDocumentPart, namespaceUri);
  expect(dataPart).not.toBeNull();
  if (!dataPart) return;
  expect(readCustomXmlNode(pkg, dataPart.partName, nodeId)?.data).toBe(DATA);
  const control = contentControlsIn(mainPart(pkg).root).find((entry) =>
    contentControlPropertiesOf(entry.node).dataBinding?.xpath?.includes(`[@id='${nodeId}']`)
  );
  expect(control).toBeDefined();
  if (!control) return;
  expect(contentControlPropertiesOf(control.node).dataBinding?.storeItemID).toBe(dataPart.itemId);
}

function expectOraclesAgree(left: Replica, right: Replica): void {
  expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
  expect(saveReopenDigest(packageOf(left))).toEqual(saveReopenDigest(packageOf(right)));
}

async function pair(): Promise<{ left: Replica; right: Replica }> {
  const bytes = emptyBytes();
  const left = await seedReplica(loadPackage(bytes), undefined, 1, ALICE_REPLICA);
  const right = joinReplica(left, 2, BOB_REPLICA);
  return { left, right };
}

describe('concurrent customXml first-create', () => {
  test('both first inserts survive when neither replica has a customXml part yet', async () => {
    const bytes = emptyBytes();
    const aliceJournal = captureInsert(loadPackage(bytes), 'cx-alice', 0, 6);
    const bobJournal = captureInsert(loadPackage(bytes), 'cx-bob', 1, 0);
    for (const order of ['left-right', 'right-left'] as const) {
      const { left, right } = await pair();
      try {
        concurrent(
          left,
          right,
          () => applyTranslated(left, aliceJournal),
          () => applyTranslated(right, bobJournal),
          order
        );
        expectBoundNode(packageOf(left), 'cx-alice');
        expectBoundNode(packageOf(left), 'cx-bob');
        expectBoundNode(packageOf(right), 'cx-alice');
        expectBoundNode(packageOf(right), 'cx-bob');
        expectOraclesAgree(left, right);
      } finally {
        destroyReplica(left);
        destroyReplica(right);
      }
    }
  });

  test('concurrent inserts onto an existing customXml part both survive', async () => {
    const seeded = loadPackage(emptyBytes());
    const main = seeded.parts.get(seeded.mainDocumentPart);
    if (!main) throw new Error('missing main part');
    const store = new TreePackageStore(seeded, main);
    const port = createCollaborationDocumentPort(store, { documentId: 'custom-xml-seed' });
    const seed = insertPackageCustomNode(store, {
      paragraphId: paragraphIdAt(seeded, 0),
      offset: 0,
      tag: 'acme:citation',
      text: '(cx-seed)',
      lock: 'contentLocked',
      payload: {
        namespaceUri: NS,
        rootLocalName: ROOT,
        nodeId: 'cx-seed',
        label: '(cx-seed)',
        data: DATA,
      },
    });
    if (!seed.ok) throw new Error(String(seed.reason));
    port.flushPendingJournals();
    const bytes = writeOoxmlPackage(store.currentPackage());
    const aliceJournal = captureInsert(loadPackage(bytes), 'cx-alice', 1, 0);
    const bobJournal = captureInsert(loadPackage(bytes), 'cx-bob', 2, 0);
    const left = await seedReplica(loadPackage(bytes), undefined, 1, ALICE_REPLICA);
    const right = joinReplica(left, 2, BOB_REPLICA);
    try {
      concurrent(
        left,
        right,
        () => applyTranslated(left, aliceJournal),
        () => applyTranslated(right, bobJournal)
      );
      expectBoundNode(packageOf(left), 'cx-seed');
      expectBoundNode(packageOf(left), 'cx-alice');
      expectBoundNode(packageOf(left), 'cx-bob');
      expectBoundNode(packageOf(right), 'cx-alice');
      expectBoundNode(packageOf(right), 'cx-bob');
      expectOraclesAgree(left, right);
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('concurrent first inserts in different namespaces both keep their own store', async () => {
    const bytes = emptyBytes();
    const aliceJournal = captureInsert(loadPackage(bytes), 'cx-alice', 0, 6, NS);
    const bobJournal = captureInsert(loadPackage(bytes), 'cx-bob', 1, 0, NS_OTHER);
    const { left, right } = await pair();
    try {
      concurrent(
        left,
        right,
        () => applyTranslated(left, aliceJournal),
        () => applyTranslated(right, bobJournal)
      );
      expectBoundNode(packageOf(left), 'cx-alice', NS);
      expectBoundNode(packageOf(left), 'cx-bob', NS_OTHER);
      expectBoundNode(packageOf(right), 'cx-alice', NS);
      expectBoundNode(packageOf(right), 'cx-bob', NS_OTHER);
      expect(
        findCustomXmlDataPart(packageOf(left), packageOf(left).mainDocumentPart, NS)?.partName
      ).not.toBe(
        findCustomXmlDataPart(packageOf(left), packageOf(left).mainDocumentPart, NS_OTHER)?.partName
      );
      expectOraclesAgree(left, right);
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });
});
