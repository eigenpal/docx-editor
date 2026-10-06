/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A shared document opened from a package that carries a highly compressible entry, a
// custom XML part with non-ASCII element names, and a content-type record with malformed
// MIME syntax. The room must open, edits must converge across peers and a cold join, and
// the preserved parts must survive save and reopen.

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { CT, OD, REL, W, createPeerHarness, walk, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('package-tolerance-room');

afterEach(() => {
  harness.cleanup();
});

const CUSTOM_XML = '<Ügyfél xmlns="urn:example:record"><Größe>12</Größe><名前>x</名前></Ügyfél>';
const INVALID_DEFAULT = '<Default Extension="JPG" ContentType="image/.jpg"/>';

function tolerantDocument(): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          INVALID_DEFAULT +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
      ),
      'customXml/item1.xml': strToU8(CUSTOM_XML),
      'word/embeddings/blank.bin': new Uint8Array(4_700),
    },
    { level: 9 }
  );
}

function bodyText(peer: Peer): string {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue') texts.push(node.value);
  });
  return texts.join('|');
}

describe('collaboration over a tolerated package', () => {
  test('opens, converges under concurrent edits and a cold join, and saves the parts', async () => {
    const { alice, bob, pause, resume } = await harness.pair(tolerantDocument());
    pause();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 0, text: 'A ' },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 0, text: 'B ' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(bodyText(alice)).toContain('A First paragraph');
    expect(bodyText(alice)).toContain('B Second paragraph');

    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(bodyText(bob)).not.toContain('A First');
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(bodyText(bob)).toContain('A First paragraph');

    // Deletion while the other participant edits the same paragraph.
    pause();
    harness.apply(alice, [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(alice, 1), start: 2, end: 9 },
    ]);
    harness.apply(bob, [
      {
        op: 'insertText',
        paragraphId: harness.paragraphIdAt(bob, 1),
        offset: 18,
        text: ' kept',
      },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(bodyText(alice)).toContain('B paragraph kept');

    const reconnected = await harness.remount(bob);
    harness.expectConverged(alice, reconnected);
    const carol = await harness.join(alice, 'carol');
    harness.expectConverged(alice, carol);

    const saved = readOoxmlPackage(writeOoxmlPackage(harness.packageOf(carol)));
    if (!saved.ok) throw new Error(saved.reason);
    expect(saved.package.parts.get('/customXml/item1.xml')?.root.localName).toBe('Ügyfél');
    expect(strFromU8(saved.package.partBytes.get('/[Content_Types].xml')!)).toContain(
      INVALID_DEFAULT
    );
    expect(saved.package.partBytes.get('/word/embeddings/blank.bin')?.length).toBe(4_700);
  });
});
