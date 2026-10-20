/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent formatting merges property by property.
//
// Two people formatting the same text or paragraph at once each mean their own property.
// Bold from one and italic from the other is bold italic, and an indent from one with an
// alignment from the other is both. Only the same property set to two values is a conflict,
// and every replica keeps the same one of them.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('concurrent-format-merge-room');

afterEach(() => {
  harness.cleanup();
});

async function race(
  body: string,
  alice: (peer: Peer) => TreeDocOp[],
  bob: (peer: Peer) => TreeDocOp[]
): Promise<{ alice: Peer; bob: Peer }> {
  const { alice: a, bob: b, pause, resume } = await harness.pair(zipDocument(body));
  pause();
  harness.apply(a, alice(a));
  harness.apply(b, bob(b));
  resume();
  for (const peer of [a, b]) expect(peer.room.session.status()).toBe('ready');
  harness.expectConverged(a, b);
  const carol = await harness.join(a, 'carol');
  harness.expectConverged(a, carol);
  return { alice: a, bob: b };
}

/** Each character of the first paragraph with the sorted run property names it carries. */
function formats(peer: Peer): string[] {
  const out: string[] = [];
  let paragraphs = 0;
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (node.kind === 'paragraph') paragraphs += 1;
    if (paragraphs !== 1 || node.kind !== 'run') return;
    const rPr = node.children.find((child) => child.kind === 'runProperties');
    const names = rPr
      ? (rPr as Extract<OoxmlNode, { children: unknown }>).children
          .map((child) => ('localName' in child ? child.localName : ''))
          .sort()
          .join('+')
      : '';
    walk(node, (inner: OoxmlNode) => {
      if (inner.kind === 'textValue') for (const char of inner.value) out.push(`${char}:${names}`);
    });
  });
  return out;
}

/** Local names and `w:val` of the first paragraph's properties, sorted. */
function paragraphProperties(peer: Peer): string[] {
  let found: string[] = [];
  let done = false;
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (done || node.kind !== 'paragraph') return;
    done = true;
    const pPr = node.children.find((child) => child.kind === 'paragraphProperties');
    if (!pPr) return;
    found = (pPr as Extract<OoxmlNode, { children: unknown }>).children
      .filter((child) => 'attributes' in child)
      .map((child) => {
        const element = child as Extract<OoxmlNode, { attributes: unknown }>;
        const value = element.attributes.map((attribute) => attribute.value).join(',');
        return value ? `${element.localName}=${value}` : element.localName;
      })
      .sort();
  });
  return found;
}

const runFormat = (peer: Peer, start: number, end: number, localName: string): TreeDocOp => ({
  op: 'setRunProperties',
  paragraphId: harness.paragraphIdAt(peer, 0),
  start,
  end,
  properties: [{ localName }],
});

const paragraphFormat = (
  peer: Peer,
  localName: string,
  attributes: Record<string, string>
): TreeDocOp => ({
  op: 'setParagraphProperties',
  paragraphId: harness.paragraphIdAt(peer, 0),
  properties: [{ localName, attributes }],
});

const paragraphFormats = (
  peer: Peer,
  properties: readonly [string, Record<string, string>][]
): TreeDocOp => ({
  op: 'setParagraphProperties',
  paragraphId: harness.paragraphIdAt(peer, 0),
  properties: properties.map(([localName, attributes]) => ({ localName, attributes })),
});

const PLAIN = '<w:p><w:r><w:t>abcdefghij</w:t></w:r></w:p><w:sectPr/>';
const STYLED =
  '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>abcdefghij</w:t></w:r></w:p>' +
  '<w:sectPr/>';

describe('concurrent paragraph properties merge by property', () => {
  for (const [name, body] of [
    ['without existing properties', PLAIN],
    ['with existing properties', STYLED],
  ] as const) {
    test(`an alignment and an indent both survive, ${name}`, async () => {
      const { alice } = await race(
        body,
        (peer) => [paragraphFormat(peer, 'jc', { val: 'center' })],
        (peer) => [paragraphFormat(peer, 'ind', { start: '720' })]
      );
      const shown = paragraphProperties(alice);
      expect(shown).toContain('jc=center');
      expect(shown).toContain('ind=720');
    });
  }

  test('a later edit of a merged property lands on every replica', async () => {
    const { alice, bob } = await race(
      PLAIN,
      (peer) => [paragraphFormat(peer, 'jc', { val: 'center' })],
      (peer) => [paragraphFormat(peer, 'ind', { start: '720' })]
    );
    // Each changes the property the other wrote. The op sets the whole property set the
    // editor manages, as the editor's own paragraph dialog does.
    harness.apply(alice, [
      paragraphFormats(alice, [
        ['jc', { val: 'center' }],
        ['ind', { start: '1440' }],
      ]),
    ]);
    harness.apply(bob, [
      paragraphFormats(bob, [
        ['jc', { val: 'right' }],
        ['ind', { start: '1440' }],
      ]),
    ]);
    for (const peer of [alice, bob]) expect(peer.room.session.status()).toBe('ready');
    harness.expectConverged(alice, bob);
    expect(paragraphProperties(alice)).toEqual(['ind=1440', 'jc=right']);
    const carol = await harness.join(alice, 'carol');
    expect(paragraphProperties(carol)).toEqual(['ind=1440', 'jc=right']);
  });

  test('the same property set twice keeps one value on every replica', async () => {
    const { alice, bob } = await race(
      PLAIN,
      (peer) => [paragraphFormat(peer, 'jc', { val: 'center' })],
      (peer) => [paragraphFormat(peer, 'jc', { val: 'right' })]
    );
    const shown = paragraphProperties(alice).filter((entry) => entry.startsWith('jc='));
    expect(shown.length).toBe(1);
    expect(paragraphProperties(bob)).toEqual(paragraphProperties(alice));
  });
});

describe('concurrent run formatting merges by character', () => {
  test('bold and italic on the same text make it bold italic', async () => {
    const { alice } = await race(
      PLAIN,
      (peer) => [runFormat(peer, 0, 5, 'b')],
      (peer) => [runFormat(peer, 0, 5, 'i')]
    );
    expect(formats(alice).join(' ')).toBe('a:b+i b:b+i c:b+i d:b+i e:b+i f: g: h: i: j:');
  });

  test('overlapping bold and italic apply to each character they cover', async () => {
    const { alice } = await race(
      PLAIN,
      (peer) => [runFormat(peer, 0, 5, 'b')],
      (peer) => [runFormat(peer, 3, 8, 'i')]
    );
    expect(formats(alice).join(' ')).toBe('a:b b:b c:b d:b+i e:b+i f:i g:i h:i i: j:');
  });
});
