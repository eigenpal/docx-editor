/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A wrapper's fixed parts travel in the paragraph's shared text. A content control whose
// properties hold many list choices must arrive whole, and one too large for the shared text
// must be refused when the room is created, never accepted and then shown without the control.
import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { readOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { createPeerHarness, walk, zipDocument } from './document-peer-support.ts';

const harnesses: ReturnType<typeof createPeerHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

/** A paragraph with an inline drop-down content control offering `choices` items. */
function dropDown(choices: number): Uint8Array {
  const items = Array.from(
    { length: choices },
    (_, index) => `<w:listItem w:displayText="Choice ${index}" w:value="${index}"/>`
  ).join('');
  return zipDocument(
    '<w:p><w:r><w:t xml:space="preserve">Pick: </w:t></w:r>' +
      `<w:sdt><w:sdtPr><w:dropDownList>${items}</w:dropDownList></w:sdtPr>` +
      '<w:sdtContent><w:r><w:t>Choice 0</w:t></w:r></w:sdtContent></w:sdt></w:p>'
  );
}

function count(root: OoxmlNode, localName: string): number {
  let found = 0;
  walk(root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName) found += 1;
  });
  return found;
}

describe('content controls with large fixed parts', () => {
  test('a drop-down with hundreds of choices survives seeding, a join, and save', async () => {
    const harness = createPeerHarness('large-shells');
    harnesses.push(harness);
    const { alice, bob } = await harness.pair(dropDown(520));
    for (const peer of [alice, bob]) {
      expect(peer.room.session.status()).toBe('ready');
      const pkg = harness.packageOf(peer);
      const root = pkg.parts.get(pkg.mainDocumentPart)!.root;
      expect(count(root, 'sdt')).toBe(1);
      expect(count(root, 'listItem')).toBe(520);
    }
    const reopened = readOoxmlPackage(alice.room.document);
    if (!reopened.ok) throw new Error(reopened.reason);
    const main = reopened.package.parts.get(reopened.package.mainDocumentPart)!.root;
    expect(count(main, 'listItem')).toBe(520);
  });

  test('a control too large for the shared text refuses the room instead of losing it', async () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    try {
      await expect(
        createDocumentCollaboration({
          ydoc,
          awareness,
          documentId: 'too-large-shell',
          identity: { actorId: 'alice', name: 'Alice' },
          bootstrap: { kind: 'create', document: dropDown(40_000) },
        })
      ).rejects.toMatchObject({ code: 'too-many-nodes' });
    } finally {
      awareness.destroy();
      ydoc.destroy();
    }
  });

  test('a tag longer than the shared text holds refuses the room instead of losing it', async () => {
    const tagged = (length: number) =>
      zipDocument(
        '<w:p><w:sdt><w:sdtPr>' +
          `<w:tag w:val="${'t'.repeat(length)}"/>` +
          '</w:sdtPr><w:sdtContent><w:r><w:t>Value</w:t></w:r></w:sdtContent></w:sdt></w:p>'
      );
    // At the bound the control arrives whole.
    const harness = createPeerHarness('long-tag');
    harnesses.push(harness);
    const { alice } = await harness.pair(tagged(4_096));
    const pkg = harness.packageOf(alice);
    expect(count(pkg.parts.get(pkg.mainDocumentPart)!.root, 'tag')).toBe(1);
    // One past it, the room is refused with the bound it breaks.
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    try {
      await expect(
        createDocumentCollaboration({
          ydoc,
          awareness,
          documentId: 'long-tag-refused',
          identity: { actorId: 'alice', name: 'Alice' },
          bootstrap: { kind: 'create', document: tagged(4_097) },
        })
      ).rejects.toMatchObject({ code: 'invalid-string' });
    } finally {
      awareness.destroy();
      ydoc.destroy();
    }
  });
});
