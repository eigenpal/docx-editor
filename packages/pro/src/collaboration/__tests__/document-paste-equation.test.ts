/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A pasted Word equation is an `m:oMath` atom. It must reach every peer intact, merge
// with concurrent typing in the same paragraph, and stay removable by any participant.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { ooxmlTreesEqual, type OoxmlNode, type OoxmlPackage } from '@docx-editor.dev/core/store';
import { CT, OD, REL, W, createPeerHarness, walk, zipDocument } from './document-peer-support.ts';
import { saveReopenDigest } from './document-support.ts';

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

const harness = createPeerHarness('paste-equation-room');

afterEach(() => harness.cleanup());

/** The fragment the Word HTML projection writes for one inline fraction. */
function equationFragment(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p>` +
        '<m:oMath><m:f><m:num><m:r><m:t xml:space="preserve">a</m:t></m:r></m:num>' +
        '<m:den><m:r><m:t xml:space="preserve">b</m:t></m:r></m:den></m:f></m:oMath>' +
        '</w:p></w:body></w:document>'
    ),
  });
}

function equationsOf(pkg: OoxmlPackage): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
    if (node.kind !== 'textValue' && node.namespaceUri === M && node.localName === 'oMath') {
      found.push(node);
    }
  });
  return found;
}

function bodyText(pkg: OoxmlPackage): string {
  const parts: string[] = [];
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
    if (node.kind === 'textValue') parts.push(node.value);
  });
  return parts.join('');
}

function pasteEquation(
  peer: Parameters<typeof harness.packageOf>[0],
  paragraphId: string,
  offset: number
): void {
  const pasted = peer.store.applyFragmentPaste(
    { kind: 'body' },
    { paragraphId, offset, fragmentBytes: equationFragment(), lastMarkCovered: false }
  );
  if (!pasted.ok) throw new Error(pasted.detail ?? pasted.reason);
  peer.port.flushPendingJournals();
}

function expectSame(left: OoxmlPackage, right: OoxmlPackage): void {
  const leftMain = left.parts.get(left.mainDocumentPart)!;
  const rightMain = right.parts.get(right.mainDocumentPart)!;
  expect(ooxmlTreesEqual(leftMain, rightMain)).toBe(true);
  expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
}

describe('pasted Word equations in collaboration', () => {
  test('the equation atom reaches the peer and survives save and reopen', async () => {
    const { alice, bob } = await harness.pair(zipDocument('<w:p><w:r><w:t>Host</w:t></w:r></w:p>'));
    pasteEquation(alice, harness.paragraphIdAt(alice, 0), 2);
    const source = harness.packageOf(alice);
    const peer = harness.packageOf(bob);
    expect(equationsOf(source)).toHaveLength(1);
    expect(equationsOf(peer)).toHaveLength(1);
    expectSame(source, peer);
    harness.expectConverged(alice, bob);
  });

  test('a paste converges with concurrent typing in the same paragraph', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Host</w:t></w:r></w:p>')
    );
    const paragraphId = harness.paragraphIdAt(alice, 0);
    pause();
    pasteEquation(alice, paragraphId, 4);
    harness.apply(bob, [{ op: 'insertText', paragraphId, offset: 0, text: 'Bob ' }]);
    resume();
    const source = harness.packageOf(alice);
    const peer = harness.packageOf(bob);
    expect(equationsOf(source)).toHaveLength(1);
    expect(bodyText(source)).toContain('Bob ');
    expectSame(source, peer);
    harness.expectConverged(alice, bob);
  });

  test('another participant removes the pasted equation', async () => {
    const { alice, bob } = await harness.pair(zipDocument('<w:p><w:r><w:t>Host</w:t></w:r></w:p>'));
    pasteEquation(alice, harness.paragraphIdAt(alice, 0), 4);
    const pasted = equationsOf(harness.packageOf(bob))[0]!;
    harness.apply(bob, [{ op: 'removeMathEquation', equationId: pasted.id }]);
    expect(equationsOf(harness.packageOf(alice))).toHaveLength(0);
    expect(bodyText(harness.packageOf(alice))).toContain('Host');
    harness.expectConverged(alice, bob);
  });
});
