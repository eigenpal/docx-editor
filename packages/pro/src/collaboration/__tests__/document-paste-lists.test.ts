/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A pasted list must arrive whole on every replica: its paragraphs, their identities, and the
// numbering definitions they reference.
//
// Pasted HTML is projected into a fragment whose paragraphs carry no `w14:paraId`, and whose
// numbering has to merge into a `numbering.xml` the document already holds. Each half failed
// on its own: the paragraphs after the first landed without an identity, and the merged
// definitions were overwritten by the pre-paste part, so the pasted paragraphs pointed at a
// `numId` the document did not have. Two peers pasting from one snapshot also must not mint
// the same identity or the same `numId` for different content.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { OoxmlNode, OoxmlPackage } from '@docx-editor.dev/core/store';
import {
  CT,
  REL,
  createPeerHarness,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMBERING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';

/** A three-item decimal list with no paragraph identities, the shape projected HTML has. */
function listFragment(label: string): Uint8Array {
  const item = (text: string) =>
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/numbering.xml" ContentType="${NUMBERING_CT}"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdN" Type="${NUMBERING}" Target="numbering.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        `${item(`${label} one`)}${item(`${label} two`)}${item(`${label} three`)}` +
        '</w:body></w:document>'
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
        '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    ),
  });
}

/** A host that already numbers a paragraph, so the paste merges into an existing part. */
function numberedHost(): Uint8Array {
  return zipDocument(
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:t>Host item</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p><w:sectPr/>',
    {
      overrides: `<Override PartName="/word/numbering.xml" ContentType="${NUMBERING_CT}"/>`,
      documentRels:
        `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId9" Type="${NUMBERING}" Target="numbering.xml"/>` +
        '</Relationships>',
      extraXml: {
        'word/numbering.xml':
          `<w:numbering xmlns:w="${W}">` +
          '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
          '<w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum>' +
          '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
      },
    }
  );
}

function attributeOf(node: OoxmlNode, namespaceUri: string, localName: string): string | null {
  if (node.kind === 'textValue') return null;
  return (
    node.attributes.find(
      (attribute) => attribute.namespaceUri === namespaceUri && attribute.localName === localName
    )?.value ?? null
  );
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return node.kind !== 'textValue' && node.namespaceUri === W && node.localName === localName;
}

/** Every body paragraph's `w14:paraId`, document order. */
function paraIds(pkg: OoxmlPackage): (string | null)[] {
  const ids: (string | null)[] = [];
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
    if (isWml(node, 'p')) ids.push(attributeOf(node, W14, 'paraId'));
  });
  return ids;
}

/** Every `w:numId/@w:val` a body paragraph references. */
function referencedNumIds(pkg: OoxmlPackage): Set<string> {
  const ids = new Set<string>();
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
    if (!isWml(node, 'numId')) return;
    const value = attributeOf(node, W, 'val');
    if (value !== null) ids.add(value);
  });
  return ids;
}

/** `w:num/@w:numId` values in numbering.xml, duplicates kept. */
function definedNumIds(pkg: OoxmlPackage): string[] {
  const part = pkg.parts.get('/word/numbering.xml');
  if (!part) return [];
  return part.root.children
    .filter((child) => isWml(child, 'num'))
    .map((child) => attributeOf(child, W, 'numId') ?? '');
}

function expectListIntact(pkg: OoxmlPackage): void {
  const ids = paraIds(pkg);
  expect(ids.every((id) => id !== null && /^[0-9A-F]{8}$/.test(id))).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  const defined = definedNumIds(pkg);
  expect(new Set(defined).size).toBe(defined.length);
  for (const numId of referencedNumIds(pkg)) expect(defined).toContain(numId);
}

function pasteOn(
  harness: ReturnType<typeof createPeerHarness>,
  peer: Peer,
  fragmentBytes: Uint8Array,
  paragraphIndex = 1
): void {
  const pasted = peer.store.applyFragmentPaste(
    { kind: 'body' },
    {
      paragraphId: harness.paragraphIdAt(peer, paragraphIndex),
      offset: 0,
      fragmentBytes,
      lastMarkCovered: true,
      actorId: peer.room.session.identity.actorId,
    }
  );
  if (!pasted.ok) throw new Error(pasted.detail ?? pasted.reason);
  peer.port.flushPendingJournals();
}

const harness = createPeerHarness('paste-list-room');

afterEach(() => harness.cleanup());

describe('a pasted list replicates whole', () => {
  test('identities and merged numbering reach the peer', async () => {
    const { alice, bob } = await harness.pair(numberedHost());
    pasteOn(harness, alice, listFragment('Alice'));
    const source = harness.packageOf(alice);
    expect(paraIds(source)).toHaveLength(5);
    expect(definedNumIds(source)).toHaveLength(2);
    expectListIntact(source);
    expectListIntact(harness.packageOf(bob));
    harness.expectConverged(alice, bob);
  });

  test('undo and redo of the paste converge, and the result survives save and reopen', async () => {
    const { alice, bob } = await harness.pair(numberedHost());
    pasteOn(harness, alice, listFragment('Alice'));
    const pasted = paraIds(harness.packageOf(alice));

    expect(alice.room.session.undo()).toBe(true);
    alice.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    expect(paraIds(harness.packageOf(bob))).toHaveLength(2);
    expectListIntact(harness.packageOf(bob));

    expect(alice.room.session.redo()).toBe(true);
    alice.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    const redone = harness.packageOf(bob);
    expect(paraIds(redone)).toEqual(pasted);
    expectListIntact(redone);

    // A late joiner opens the shared state from scratch: the save/reopen path.
    const carol = await harness.join(bob, 'carol');
    harness.expectConverged(bob, carol);
    expectListIntact(harness.packageOf(carol));
  });

  // Each peer's list imports under its own stripe, so both definitions coexist in one
  // `numbering.xml` and every identity stays unique. Two pastes at the SAME position rebuild
  // one host paragraph twice, which is the open same-paragraph conflict (#579), not a
  // numbering or identity question.
  test('two peers pasting lists from one snapshot converge without collisions', async () => {
    const { alice, bob, pause, resume } = await harness.pair(numberedHost());
    pause();
    pasteOn(harness, alice, listFragment('Alice'), 1);
    pasteOn(harness, bob, listFragment('Bob'), 0);
    resume();
    harness.expectConverged(alice, bob);
    const merged = harness.packageOf(alice);
    expect(paraIds(merged)).toHaveLength(8);
    expect(definedNumIds(merged)).toHaveLength(3);
    expectListIntact(merged);
  });

  test('a paste converges with a concurrent deletion of the neighbouring paragraph', async () => {
    const { alice, bob, pause, resume } = await harness.pair(numberedHost());
    pause();
    pasteOn(harness, alice, listFragment('Alice'), 1);
    harness.apply(bob, [{ op: 'deleteBlock', blockId: harness.paragraphIdAt(bob, 0) }]);
    resume();
    harness.expectConverged(alice, bob);
    const merged = harness.packageOf(alice);
    expect(paraIds(merged)).toHaveLength(4);
    expectListIntact(merged);
  });
});
