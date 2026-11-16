/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { partNameKey, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { DocumentRegistry, applyPrimitiveJournal, LogicalIdAllocator } from '../document/index.ts';
import { readCollaborationDocument } from '../document-read.ts';
import { createPeerHarness, zipDocument, W, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('content-type-export');
afterEach(() => harness.cleanup());

function contentTypeOf(kind: string): string {
  return `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`;
}

/** Add an empty part and its override on one peer, as a recorded journal would. */
function addPart(peer: Peer, partName: string, root: string, kind: string): void {
  const registry = new DocumentRegistry(peer.ydoc);
  try {
    const id = new LogicalIdAllocator().take();
    const result = applyPrimitiveJournal(registry, {
      effects: [
        {
          kind: 'putNode',
          descriptor: {
            logicalId: id,
            kind: 'generic',
            qname: { namespaceUri: W, localName: root, prefix: 'w' },
          },
        },
        { kind: 'setNamespaceBinding', logicalId: id, prefix: 'w', uri: W },
        { kind: 'putXmlPart', name: partName, rootLogicalId: id },
        { kind: 'putContentTypeOverride', partName, mediaType: contentTypeOf(kind) },
      ],
    });
    expect(result.ok).toBe(true);
  } finally {
    registry.destroy();
  }
}

function savedContentTypes(peer: Peer): string {
  return strFromU8(unzipSync(readCollaborationDocument(peer.ydoc))['[Content_Types].xml']!);
}

for (const [name, root, kind] of [
  ['header1', 'hdr', 'header'],
  ['footer1', 'ftr', 'footer'],
  ['footnotes', 'footnotes', 'footnotes'],
  ['endnotes', 'endnotes', 'endnotes'],
  ['numbering', 'numbering', 'numbering'],
  ['people', 'people', 'people'],
]) {
  test(`exports the shared override for a new ${kind} part`, async () => {
    const { alice, bob } = await harness.pair(zipDocument('<w:p/><w:sectPr/>'));
    const partName = `/word/${name}.xml`;
    addPart(alice, partName, root!, kind!);
    for (const peer of [alice, bob]) {
      const reopened = readOoxmlPackage(readCollaborationDocument(peer.ydoc));
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(reopened.package.parts.has(partName)).toBe(true);
      expect(reopened.package.contentTypes.overrides.get(partNameKey(partName))).toBe(
        contentTypeOf(kind!)
      );
    }
  });
}

test('parts added concurrently save the same content types on every peer', async () => {
  const { alice, bob, pause, resume } = await harness.pair(zipDocument('<w:p/><w:sectPr/>'));
  pause();
  addPart(alice, '/word/header1.xml', 'hdr', 'header');
  addPart(bob, '/word/footer1.xml', 'ftr', 'footer');
  resume();
  harness.expectConverged(alice, bob);
  const saved = savedContentTypes(alice);
  expect(saved).toContain('PartName="/word/header1.xml"');
  expect(saved).toContain('PartName="/word/footer1.xml"');
  expect(savedContentTypes(bob)).toBe(saved);
});
