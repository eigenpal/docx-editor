/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent variant edits converge (gap 3).
//
// The journal-coverage gate proves each variant replays a SINGLE author's edit onto a fresh
// replica. That is not the same claim as: two peers editing the same target CONCURRENTLY
// converge. This drives real Yjs merges through the production registry + materializer — two
// peers each author a different variant of the same property on the same node with the wire
// paused, then reconnect — and asserts both replicas reach one document (fingerprint plus
// save/reopen digest). A variant whose merge diverged would fail here, where the
// single-author gate could not see it.

import { afterEach, describe, expect, test } from 'bun:test';
import type { ImageDecodePort, StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import { BODY, createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('concurrent-variants-room');

afterEach(() => {
  harness.cleanup();
});

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

const decodePort: ImageDecodePort = {
  decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
};

function proseDoc(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>Alpha bravo canvas delta editor</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p><w:sectPr/>'
  );
}

function drawingId(peer: Peer): string {
  let found: string | undefined;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (!found && node.kind === 'drawing') found = node.id;
  });
  if (!found) throw new Error('missing drawing');
  return found;
}

function bodyText(peer: Peer): string {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue') texts.push(node.value);
  });
  return texts.join('');
}

/** Each body paragraph as `<pPr and its jc/ind children>|<text>`. */
function paragraphDump(peer: Peer): string[] {
  const out: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind !== 'paragraph') return;
    let text = '';
    const props: string[] = [];
    walk(node, (child) => {
      if (child.kind === 'textValue') text += child.value;
      else if (child.localName === 'pPr') props.push('pPr');
      else if (child.localName === 'jc' || child.localName === 'ind') props.push(child.localName);
    });
    out.push(`${props.join(',')}|${text}`);
  });
  return out;
}

function hasElement(peer: Peer, localName: string): boolean {
  let present = false;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName) present = true;
  });
  return present;
}

/** Every value of one attribute across all elements of a localName, so a dropped or
 * duplicated instance is visible — `hasElement` alone matches any single survivor. */
function attributeValues(peer: Peer, localName: string, attribute: string): string[] {
  const values: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue' || node.localName !== localName) return;
    const found = node.attributes.find((a) => a.localName === attribute);
    if (found) values.push(found.value);
  });
  return values.sort();
}

/**
 * Apply two concurrent edits with the wire paused, reconnect, and assert convergence.
 *
 * Convergence is peer-to-peer equality, which two identically-corrupt replicas also satisfy,
 * so the caller passes an `expect` that checks the merged document is actually CORRECT — the
 * edits present, the text intact. Without it a silent drop or a silent duplication passes.
 */
async function converges(
  bytes: Uint8Array,
  aliceOp: (peer: Peer) => readonly TreeDocOp[],
  bobOp: (peer: Peer) => readonly TreeDocOp[],
  check: (peer: Peer) => void,
  scope: StoryScope = BODY
): Promise<void> {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  pause();
  harness.apply(alice, aliceOp(alice), scope);
  harness.apply(bob, bobOp(bob), scope);
  resume();
  harness.expectConverged(alice, bob);
  check(alice);
  check(bob);
}

describe('concurrent variant edits converge', () => {
  test('two indents on DIFFERENT paragraphs', async () => {
    // Independent property edits merge cleanly — the ordinary collaborative case. Both
    // indents survive and neither paragraph's text is disturbed.
    await converges(
      proseDoc(),
      (peer) => [
        {
          op: 'setParagraphProperties',
          paragraphId: harness.paragraphIdAt(peer, 0),
          properties: [{ localName: 'ind', attributes: { start: '720' } }],
        },
      ],
      (peer) => [
        {
          op: 'setParagraphProperties',
          paragraphId: harness.paragraphIdAt(peer, 1),
          properties: [{ localName: 'ind', attributes: { start: '1440' } }],
        },
      ],
      (peer) => {
        // BOTH indents must survive — a count/value check, not `hasElement`, which any
        // single survivor would satisfy.
        expect(attributeValues(peer, 'ind', 'start')).toEqual(['1440', '720']);
        expect(bodyText(peer)).toBe('Alpha bravo canvas delta editorSecond paragraph');
      }
    );
  });

  test('bold and text on different paragraphs', async () => {
    // Run formatting on one paragraph, text on another: independent, so both apply with the
    // text intact.
    await converges(
      proseDoc(),
      (peer) => [
        {
          op: 'setRunProperties',
          paragraphId: harness.paragraphIdAt(peer, 0),
          start: 0,
          end: 5,
          properties: [{ localName: 'b' }],
        },
      ],
      (peer) => [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 1), offset: 0, text: 'Z' },
      ],
      (peer) => {
        expect(hasElement(peer, 'b')).toBe(true);
        expect(bodyText(peer)).toBe('Alpha bravo canvas delta editorZSecond paragraph');
      }
    );
  });

  test('same-paragraph run-property edits converge without duplicating text (#581)', async () => {
    // Two concurrent `setRunProperties` on the same paragraph each split its runs; both
    // peers stamp their new runs with the origin they replaced, and materialize keeps one
    // replica's runs deterministically. The text is intact, not doubled, and one peer's
    // formatting wins (last-writer-loses-formatting, never last-writer-loses-content).
    const { alice, bob, pause, resume } = await harness.pair(proseDoc());
    pause();
    harness.apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(alice, 0),
        start: 0,
        end: 5,
        properties: [{ localName: 'b' }],
      },
    ]);
    harness.apply(bob, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(bob, 0),
        start: 3,
        end: 9,
        properties: [{ localName: 'i' }],
      },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    // Text intact and not duplicated; a formatting mark from the winning split survives.
    expect(bodyText(alice)).toBe('Alpha bravo canvas delta editorSecond paragraph');
    expect(hasElement(alice, 'b') || hasElement(alice, 'i')).toBe(true);
  });

  test('sequential wrap changes on one drawing replicate', async () => {
    // A drawing created through the real image lane, then a wrap change, reaching the peer.
    // (Two CONCURRENT wrap changes on one drawing are a same-node property race — the same
    // limitation as concurrent paragraph properties, tracked in #579.)
    const { alice, bob } = await harness.pair(proseDoc());
    const inserted = await alice.store.insertImage(BODY, {
      paragraphId: harness.paragraphIdAt(alice, 0),
      offset: 0,
      bytes: PNG,
      mime: 'image/png',
      widthPoints: 12,
      heightPoints: 12,
      decodePort,
      expectedPackageRevision: alice.store.packageRevision,
    });
    if (!inserted.ok) throw new Error(inserted.detail ?? inserted.reason);
    alice.port.flushPendingJournals();
    harness.apply(alice, [
      { op: 'setDrawingWrap', drawingNodeId: drawingId(alice), wrap: 'tight' },
    ]);
    // The wrap must actually reach bob: assert the anchor now carries a wrapTight element,
    // not merely that a drawing exists.
    expect(bob.room.session.statusSnapshot().status).toBe('ready');
    expect(hasElement(bob, 'wrapTight')).toBe(true);
    harness.expectConverged(alice, bob);
  });

  test('making a drawing inline while a peer wraps its anchor keeps a valid drawing', async () => {
    // The placement element is one record whose kind is inline or anchor. One peer makes it
    // inline; the other gives the anchor a new wrap. Merged, an inline drawing held a wrap
    // element, which the schema refuses, and every replica stopped applying updates.
    const { alice, bob, pause, resume } = await harness.pair(proseDoc());
    const inserted = await alice.store.insertImage(BODY, {
      paragraphId: harness.paragraphIdAt(alice, 0),
      offset: 0,
      bytes: PNG,
      mime: 'image/png',
      widthPoints: 12,
      heightPoints: 12,
      decodePort,
      expectedPackageRevision: alice.store.packageRevision,
    });
    if (!inserted.ok) throw new Error(inserted.detail ?? inserted.reason);
    alice.port.flushPendingJournals();
    harness.apply(alice, [
      { op: 'setDrawingWrap', drawingNodeId: drawingId(alice), wrap: 'square' },
    ]);
    pause();
    harness.apply(alice, [
      { op: 'setDrawingWrap', drawingNodeId: drawingId(alice), wrap: 'inline' },
    ]);
    harness.apply(bob, [{ op: 'setDrawingWrap', drawingNodeId: drawingId(bob), wrap: 'tight' }]);
    resume();
    for (const peer of [alice, bob]) {
      expect(peer.room.session.statusSnapshot().status).toBe('ready');
    }
    harness.expectConverged(alice, bob);
  });

  test('a shared paragraph property and a concurrent text edit', async () => {
    // Different concerns on one paragraph — a property rebuild and a text insert. They
    // converge with the text intact (jc present, the inserted X kept, no duplication).
    await converges(
      proseDoc(),
      (peer) => [
        {
          op: 'setParagraphProperties',
          paragraphId: harness.paragraphIdAt(peer, 0),
          properties: [{ localName: 'jc', attributes: { val: 'center' } }],
        },
      ],
      (peer) => [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 0, text: 'X' },
      ],
      (peer) => {
        expect(hasElement(peer, 'jc')).toBe(true);
        expect(bodyText(peer)).toBe('XAlpha bravo canvas delta editorSecond paragraph');
      }
    );
  });

  test('same-paragraph property rebuilds converge (#579)', async () => {
    // Two peers rebuilding the SAME `w:pPr` each write one `w:ind`. Every replica shows the
    // first in shared child order, so both stay `ready` and agree on one indent.
    const { alice, bob, pause, resume } = await harness.pair(proseDoc());
    pause();
    harness.apply(alice, [
      {
        op: 'setParagraphProperties',
        paragraphId: harness.paragraphIdAt(alice, 0),
        properties: [{ localName: 'ind', attributes: { start: '720' } }],
      },
    ]);
    harness.apply(bob, [
      {
        op: 'setParagraphProperties',
        paragraphId: harness.paragraphIdAt(bob, 0),
        properties: [{ localName: 'ind', attributes: { start: '1440' } }],
      },
    ]);
    resume();
    expect(alice.room.session.statusSnapshot().status).toBe('ready');
    expect(bob.room.session.statusSnapshot().status).toBe('ready');
    harness.expectConverged(alice, bob);
  });

  for (const formatted of [true, false]) {
    const label = formatted ? 'with paragraph properties' : 'of plain paragraphs';
    test(`same-position multi-paragraph pastes ${label} converge (#579)`, async () => {
      // Each paste rebuilds the host paragraph with the fragment's first paragraph. Two peers
      // pasting at one offset both rebuild that paragraph from one snapshot.
      const fragment = (author: string) =>
        zipDocument(
          (formatted ? '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' : '<w:p>') +
            `<w:r><w:t>${author} one</w:t></w:r></w:p>` +
            (formatted ? '<w:p><w:pPr><w:ind w:start="720"/></w:pPr>' : '<w:p>') +
            `<w:r><w:t>${author} two</w:t></w:r></w:p>`
        );
      const paste = (peer: Peer, author: string) => {
        const pasted = peer.store.applyFragmentPaste(BODY, {
          paragraphId: harness.paragraphIdAt(peer, 0),
          offset: 5,
          fragmentBytes: fragment(author),
          lastMarkCovered: true,
        });
        if (!pasted.ok) throw new Error(pasted.detail ?? pasted.reason);
        peer.port.flushPendingJournals();
      };
      const { alice, bob, pause, resume } = await harness.pair(proseDoc());
      pause();
      paste(alice, 'Alice');
      paste(bob, 'Bob');
      resume();
      expect(alice.room.session.statusSnapshot().status).toBe('ready');
      expect(bob.room.session.statusSnapshot().status).toBe('ready');
      harness.expectConverged(alice, bob);
      for (const peer of [alice, bob]) {
        const text = bodyText(peer);
        for (const piece of ['Alice one', 'Alice two', 'Bob one', 'Bob two', 'Alpha']) {
          expect(text).toContain(piece);
        }
        expect(text).toContain('bravo canvas delta editor');
        expect(text).toContain('Second paragraph');
        // One property container per paragraph, and nothing lost or doubled.
        const paragraphs = paragraphDump(peer);
        for (const paragraph of paragraphs) {
          expect(
            paragraph
              .split('|')[0]!
              .split(',')
              .filter((name) => name === 'pPr').length
          ).toBeLessThanOrEqual(1);
        }
        expect(text.split('Alpha').length).toBe(2);
        expect(text.split('bravo').length).toBe(2);
        // The host text stays first, both first pasted paragraphs follow it in one order, and
        // the head paragraph keeps one of the two pasted formats.
        expect(['AlphaAlice oneBob one', 'AlphaBob oneAlice one']).toContain(
          paragraphs[0]!.split('|')[1]!
        );
        if (formatted) expect(paragraphs[0]!.split('|')[0]).toBe('pPr,jc');
      }
      // Both peers can still edit and replicate after the merge.
      harness.apply(alice, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 0, text: '!' },
      ]);
      harness.expectConverged(alice, bob);
      expect(bodyText(bob).startsWith('!')).toBe(true);
    });
  }
});
