/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Foreign run property extensions under concurrent formatting.
//
// A run property child outside the WordprocessingML namespace (`e:b`) is not the property
// that shares its local name. A formatting edit on any replica neither rewrites it as `w:b`
// nor removes it, so every replica keeps the extension and shows the same formatting.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, W, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('foreign-run-properties-room');

afterEach(() => {
  harness.cleanup();
});

const FOREIGN =
  '<w:p><w:r><w:rPr><e:b xmlns:e="urn:foreign"/></w:rPr><w:t>abcdefghij</w:t></w:r></w:p>' +
  '<w:sectPr/>';

/** Each character of the first paragraph with its sorted, prefix-qualified run properties. */
function formats(peer: Peer): string {
  const out: string[] = [];
  let paragraphs = 0;
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (node.kind === 'paragraph') paragraphs += 1;
    if (paragraphs !== 1 || node.kind !== 'run') return;
    const rPr = node.children.find((child) => child.kind === 'runProperties');
    const names = rPr
      ? (rPr as Extract<OoxmlNode, { children: unknown }>).children
          .map((child) =>
            'localName' in child ? `${child.namespaceUri === W ? 'w' : 'e'}:${child.localName}` : ''
          )
          .sort()
          .join('+')
      : '';
    walk(node, (inner: OoxmlNode) => {
      if (inner.kind === 'textValue') for (const char of inner.value) out.push(`${char}:${names}`);
    });
  });
  return out.join(' ');
}

const runFormat = (
  peer: Peer,
  start: number,
  end: number,
  properties: readonly { readonly localName: string }[]
): TreeDocOp => ({
  op: 'setRunProperties',
  paragraphId: harness.paragraphIdAt(peer, 0),
  start,
  end,
  properties,
});

describe('foreign run property extensions in a shared document', () => {
  test('concurrent formatting keeps the extension on every replica', async () => {
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(FOREIGN));
    pause();
    harness.apply(alice, [runFormat(alice, 0, 5, [{ localName: 'i' }])]);
    harness.apply(bob, [runFormat(bob, 3, 8, [{ localName: 'b' }])]);
    resume();
    for (const peer of [alice, bob]) expect(peer.room.session.status()).toBe('ready');
    harness.expectConverged(alice, bob);
    const expected =
      'a:e:b+w:i b:e:b+w:i c:e:b+w:i d:e:b+w:b+w:i e:e:b+w:b+w:i ' +
      'f:e:b+w:b g:e:b+w:b h:e:b+w:b i:e:b j:e:b';
    expect(formats(alice)).toBe(expected);
    const carol = await harness.join(alice, 'carol');
    harness.expectConverged(alice, carol);
    expect(formats(carol)).toBe(expected);
  });

  test('clearing direct formatting on another replica keeps the extension', async () => {
    const { alice, bob } = await harness.pair(zipDocument(FOREIGN));
    harness.apply(alice, [runFormat(alice, 0, 10, [{ localName: 'b' }])]);
    harness.expectConverged(alice, bob);
    harness.apply(bob, [runFormat(bob, 0, 10, [])]);
    harness.expectConverged(alice, bob);
    expect(formats(alice)).toBe('a:e:b b:e:b c:e:b d:e:b e:e:b f:e:b g:e:b h:e:b i:e:b j:e:b');
  });
});
