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
// A custom-node write is three package edits: the customXml data part (created if
// absent), the node inside it, and the bound `w:sdt`. A journal that carried only
// the control would leave a peer with a binding that names a store it does not hold.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  CUSTOM_XML_PROPS_TYPE,
  CUSTOM_XML_REL,
  contentControlPropertiesOf,
  contentControlsIn,
  findCustomXmlDataPart,
  insertPackageCustomNode,
  readCustomXmlNode,
  relationshipsOf,
  resolveContentTypeOf,
} from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const NS = 'https://example.test/nodes';
const ROOT = 'nodes';
const DATA = JSON.stringify({ sourceId: 'src_9f3', year: 2024 });
const peers = createPeerHarness('custom-node-replication-room');

afterEach(() => peers.cleanup());

function emptyBytes(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>Before after</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Third</w:t></w:r></w:p>' +
      '<w:sectPr/>'
  );
}

function insertOn(peer: Peer, nodeId: string, paragraphIndex = 0, offset = 6): string {
  const result = insertPackageCustomNode(peer.store, {
    paragraphId: peers.paragraphIdAt(peer, paragraphIndex),
    offset,
    tag: 'acme:citation',
    text: '(Smith 2024)',
    lock: 'contentLocked',
    payload: {
      namespaceUri: NS,
      rootLocalName: ROOT,
      nodeId,
      label: '(Smith 2024)',
      data: DATA,
    },
  });
  if (!result.ok) throw new Error(String(result.reason));
  peer.port.flushPendingJournals();
  if (result.nodeId === undefined) throw new Error('missing control id');
  return result.nodeId;
}

function expectCustomNodeOnPeer(peer: Peer, nodeId: string): void {
  const pkg = peers.packageOf(peer);
  const dataPart = findCustomXmlDataPart(pkg, pkg.mainDocumentPart, NS);
  expect(dataPart).not.toBeNull();
  if (!dataPart) return;
  const node = readCustomXmlNode(pkg, dataPart.partName, nodeId);
  expect(node?.label).toBe('(Smith 2024)');
  expect(node?.data).toBe(DATA);
  expect(pkg.parts.has(dataPart.propsPartName)).toBe(true);
  expect(resolveContentTypeOf(pkg, dataPart.propsPartName)).toBe(CUSTOM_XML_PROPS_TYPE);
  expect(
    relationshipsOf(pkg, pkg.mainDocumentPart).some((record) => record.type === CUSTOM_XML_REL)
  ).toBe(true);
  const controls = contentControlsIn(peer.store.bodyStore().part.root);
  expect(controls.length).toBeGreaterThan(0);
  const control = controls.find((entry) =>
    contentControlPropertiesOf(entry.node).dataBinding?.xpath?.includes(`[@id='${nodeId}']`)
  );
  expect(control).toBeDefined();
  if (!control) return;
  const binding = contentControlPropertiesOf(control.node).dataBinding;
  expect(binding?.storeItemID).toBe(dataPart.itemId);
  expect(binding?.xpath).toContain(`[@id='${nodeId}']`);
}

describe('inserting a custom node replicates the store, the node, and the bound control', () => {
  test('creating the customXml part lands the part, props, relationship and sdt on the peer', async () => {
    const { alice, bob } = await peers.pair(emptyBytes());
    expect(
      findCustomXmlDataPart(peers.packageOf(alice), alice.store.bodyStore().part.name, NS)
    ).toBeNull();
    insertOn(alice, 'cx1');
    expectCustomNodeOnPeer(alice, 'cx1');
    expectCustomNodeOnPeer(bob, 'cx1');
    peers.expectConverged(alice, bob);
  });

  test('a second node into an existing store replicates without a dangling binding', async () => {
    const { alice, bob } = await peers.pair(emptyBytes());
    insertOn(alice, 'cx1', 0, 0);
    insertOn(alice, 'cx2', 1, 0);
    const pkg = peers.packageOf(bob);
    const dataPart = findCustomXmlDataPart(pkg, pkg.mainDocumentPart, NS);
    expect(dataPart).not.toBeNull();
    if (!dataPart) return;
    expect(readCustomXmlNode(pkg, dataPart.partName, 'cx1')?.data).toBe(DATA);
    expect(readCustomXmlNode(pkg, dataPart.partName, 'cx2')?.data).toBe(DATA);
    expect(contentControlsIn(bob.store.bodyStore().part.root).length).toBe(2);
    peers.expectConverged(alice, bob);
  });
});

describe('concurrent custom-node inserts', () => {
  test('both first inserts survive when neither replica has a customXml part yet', async () => {
    const { alice, bob, pause, resume } = await peers.pair(emptyBytes());
    pause();
    insertOn(alice, 'cx-alice', 0, 6);
    insertOn(bob, 'cx-bob', 1, 0);
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCustomNodeOnPeer(alice, 'cx-alice');
    expectCustomNodeOnPeer(alice, 'cx-bob');
    expectCustomNodeOnPeer(bob, 'cx-alice');
    expectCustomNodeOnPeer(bob, 'cx-bob');
    peers.expectConverged(alice, bob);
  });

  test('concurrent inserts onto an existing customXml part both survive', async () => {
    const { alice, bob, pause, resume } = await peers.pair(emptyBytes());
    insertOn(alice, 'cx-seed', 0, 0);
    pause();
    insertOn(alice, 'cx-alice', 1, 0);
    insertOn(bob, 'cx-bob', 2, 0);
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCustomNodeOnPeer(alice, 'cx-seed');
    expectCustomNodeOnPeer(alice, 'cx-alice');
    expectCustomNodeOnPeer(alice, 'cx-bob');
    expectCustomNodeOnPeer(bob, 'cx-alice');
    expectCustomNodeOnPeer(bob, 'cx-bob');
    peers.expectConverged(alice, bob);
  });

  test('a sequential insert after a concurrent first-create still lands on both replicas', async () => {
    const { alice, bob, pause, resume } = await peers.pair(emptyBytes());
    pause();
    insertOn(alice, 'cx-alice', 0, 6);
    insertOn(bob, 'cx-bob', 1, 0);
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCustomNodeOnPeer(alice, 'cx-alice');
    expectCustomNodeOnPeer(alice, 'cx-bob');
    insertOn(alice, 'cx-third', 2, 0);
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCustomNodeOnPeer(alice, 'cx-alice');
    expectCustomNodeOnPeer(alice, 'cx-bob');
    expectCustomNodeOnPeer(alice, 'cx-third');
    expectCustomNodeOnPeer(bob, 'cx-third');
    peers.expectConverged(alice, bob);
  });

  test('concurrent first inserts in different namespaces both keep their own store', async () => {
    const { alice, bob, pause, resume } = await peers.pair(emptyBytes());
    pause();
    const aliceResult = insertPackageCustomNode(alice.store, {
      paragraphId: peers.paragraphIdAt(alice, 0),
      offset: 6,
      tag: 'acme:citation',
      text: '(Smith 2024)',
      lock: 'contentLocked',
      payload: {
        namespaceUri: NS,
        rootLocalName: ROOT,
        nodeId: 'cx-alice',
        label: '(Smith 2024)',
        data: DATA,
      },
    });
    const otherNs = 'https://example.test/other-nodes';
    const bobResult = insertPackageCustomNode(bob.store, {
      paragraphId: peers.paragraphIdAt(bob, 1),
      offset: 0,
      tag: 'acme:citation',
      text: '(Smith 2024)',
      lock: 'contentLocked',
      payload: {
        namespaceUri: otherNs,
        rootLocalName: ROOT,
        nodeId: 'cx-bob',
        label: '(Smith 2024)',
        data: DATA,
      },
    });
    if (!aliceResult.ok) throw new Error(String(aliceResult.reason));
    if (!bobResult.ok) throw new Error(String(bobResult.reason));
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCustomNodeOnPeer(alice, 'cx-alice');
    const bobPkg = peers.packageOf(bob);
    expect(findCustomXmlDataPart(bobPkg, bobPkg.mainDocumentPart, otherNs)).not.toBeNull();
    expect(
      readCustomXmlNode(
        bobPkg,
        findCustomXmlDataPart(bobPkg, bobPkg.mainDocumentPart, otherNs)!.partName,
        'cx-bob'
      )?.data
    ).toBe(DATA);
    peers.expectConverged(alice, bob);
  });
});
