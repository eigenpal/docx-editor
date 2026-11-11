/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { partNameKey, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { DocumentRegistry, applyPrimitiveJournal, LogicalIdAllocator } from '../document/index.ts';
import { readCollaborationDocument } from '../document-read.ts';
import { createPeerHarness, zipDocument, W } from './document-peer-support.ts';

const harness = createPeerHarness('content-type-export');
afterEach(() => harness.cleanup());

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
    const registry = new DocumentRegistry(alice.ydoc);
    try {
      const id = new LogicalIdAllocator().take();
      const partName = `/word/${name}.xml`;
      const contentType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`;
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
          { kind: 'putContentTypeOverride', partName, mediaType: contentType },
        ],
      });
      expect(result.ok).toBe(true);
      for (const peer of [alice, bob]) {
        const reopened = readOoxmlPackage(readCollaborationDocument(peer.ydoc));
        if (!reopened.ok) throw new Error(reopened.reason);
        expect(reopened.package.parts.has(partName)).toBe(true);
        expect(reopened.package.contentTypes.overrides.get(partNameKey(partName))).toBe(
          contentType
        );
      }
    } finally {
      registry.destroy();
    }
  });
}
