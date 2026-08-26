/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers relocating the SAME existing node must still converge, and must not brick the room.
//
// `splitParagraph` and `applyFragmentPaste` both express "this paragraph now ends here" as a
// relocation: the runs after the caret are UNLISTED from the original paragraph and RE-LISTED
// under a newly minted one, keeping their node identity. Two peers doing that in one paragraph
// leave the run listed by two live parents, because each replica can only unlist the parent it
// saw.
//
// The materializer already answers that deterministically — first preorder placement wins, the
// rest report `duplicate-parent`, proven in `document-repair.test.ts`. Both replicas walk the
// same shared state, so both reach the same tree and no content leaves the document: the node
// is placed exactly once, and a tree could never have held it twice.
//
// What this file pins is the session on top of that. Treating the contest as dropped content
// stopped the remote apply on BOTH peers, so each one kept its own local edit forever, the
// status stuck at `error`, and `gateOperations` refused every later keystroke. Two people
// pressing Enter in one paragraph took the room read-only and permanently split-brained.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { OoxmlPackage } from '@docx-editor.dev/core/store';
import {
  CT,
  OD,
  R,
  REL,
  W,
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('concurrent-relocation-room');

afterEach(() => harness.cleanup());

/** Three runs, so a caret between two of them sits on a run boundary. */
function formattedParagraph(): Uint8Array {
  return zipDocument(
    '<w:p>' +
      '<w:r><w:t>One</w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Two</w:t></w:r>' +
      '<w:r><w:t>Three</w:t></w:r>' +
      '</w:p><w:sectPr/>'
  );
}

function textFragment(text: string): Uint8Array {
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
        '</w:body></w:document>'
    ),
  });
}

function pasteOn(peer: Peer, fragmentBytes: Uint8Array): void {
  const pasted = peer.store.applyFragmentPaste(
    { kind: 'body' },
    {
      paragraphId: harness.paragraphIdAt(peer, 0),
      offset: 0,
      fragmentBytes,
      lastMarkCovered: true,
      actorId: peer.room.session.identity.actorId,
    }
  );
  if (!pasted.ok) throw new Error(pasted.detail ?? pasted.reason);
  peer.port.flushPendingJournals();
}

function storyText(pkg: OoxmlPackage): string {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main part');
  return nodeText(main.root);
}

function paragraphTexts(pkg: OoxmlPackage): string[] {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main part');
  const texts: string[] = [];
  walk(main.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

describe('two peers relocating one existing node converge', () => {
  test('Enter at two different run boundaries in one paragraph keeps every run', async () => {
    const { alice, bob, pause, resume } = await harness.pair(formattedParagraph());

    pause();
    // Alice presses Enter after `One`; bob after `OneTwo`. Both relocate the `Three` run.
    harness.apply(alice, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(alice, 0), offset: 3 },
    ]);
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 0), offset: 6 },
    ]);
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();

    // The room stays writable. A refusal here left both authors read-only for its lifetime.
    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
    harness.expectConverged(alice, bob);

    // No run left the document. The contest drops a PLACEMENT, and a tree only ever held one.
    const story = storyText(harness.packageOf(alice));
    expect(story).toContain('One');
    expect(story).toContain('Two');
    expect(story).toContain('Three');
    expect(paragraphTexts(harness.packageOf(alice))).toEqual(
      paragraphTexts(harness.packageOf(bob))
    );

    // And the room still takes an edit afterwards.
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 0, text: 'X' },
    ]);
    expect(storyText(harness.packageOf(bob))).toContain('XOne');
    harness.expectConverged(alice, bob);
  });

  test('two concurrent pastes at the same caret both survive', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Host</w:t></w:r></w:p><w:sectPr/>')
    );

    pause();
    pasteOn(alice, textFragment('PasteFromAlice'));
    pasteOn(bob, textFragment('PasteFromBob'));
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();

    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
    harness.expectConverged(alice, bob);

    for (const peer of [alice, bob]) {
      const story = storyText(harness.packageOf(peer));
      expect(story).toContain('PasteFromAlice');
      expect(story).toContain('PasteFromBob');
      expect(story).toContain('Host');
    }
  });
});
