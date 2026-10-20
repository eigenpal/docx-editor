/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text typed beside a locked inline control takes the formatting of the text outside it. The
// rule runs where the text is written, so every peer receives the same run, also when both
// peers type at the control's edges at once, after undo and redo, and after a reconnect.

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { writeOoxmlPackage, type TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const peers = createPeerHarness('control-edge-typing-room');
afterEach(() => peers.cleanup());

const PILL =
  '<w:sdt><w:sdtPr><w:tag w:val="acme:citation"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
  '<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>[1]</w:t></w:r></w:sdtContent></w:sdt>';
const italic = (text: string) =>
  `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
// Paragraph 0 starts with the control; paragraph 1 ends with it.
const BODY =
  `<w:p>${PILL}${italic(' more')}</w:p>` + `<w:p>${italic('see ')}${PILL}</w:p>` + '<w:sectPr/>';

function body(peer: Peer): string {
  const files = unzipSync(writeOoxmlPackage(peers.packageOf(peer)));
  return strFromU8(files['word/document.xml']!);
}

function type(peer: Peer, paragraph: number, offset: number, text: string, tracked = false) {
  const op: TreeDocOp = {
    op: 'insertText',
    paragraphId: peers.paragraphIdAt(peer, paragraph),
    offset,
    text,
    ...(tracked ? { revision: { author: 'Ada', date: '2026-10-20T10:00:00Z' } } : {}),
  };
  peers.apply(peer, [op]);
}

/** The typed text sits outside the control, in an italic run, on this peer. */
function expectItalicOutside(peer: Peer, text: string): void {
  const xml = body(peer);
  const run = `<w:r><w:rPr><w:i/></w:rPr><w:t>${text}</w:t></w:r>`;
  // At the start of a paragraph the text joins nothing; at its end it stands alone too.
  expect(xml.includes(run) || xml.includes(run.replace('</w:t>', ' more</w:t>'))).toBe(true);
  expect(xml).not.toContain(`<w:b/></w:rPr><w:t>${text}`);
}

test('both peers write text typed at a locked control edge in the outside formatting', async () => {
  for (const tracked of [false, true]) {
    const { alice, bob, pause, resume } = await peers.pair(zipDocument(BODY));
    pause();
    type(alice, 0, 0, 'A', tracked);
    type(bob, 1, 7, 'B', tracked);
    resume();
    peers.expectConverged(alice, bob);
    for (const peer of [alice, bob]) {
      expectItalicOutside(peer, 'A');
      expectItalicOutside(peer, 'B');
    }
    peers.cleanup();
  }
});

test('undo, redo, and a reconnect keep the outside formatting', async () => {
  const { alice, bob } = await peers.pair(zipDocument(BODY));
  type(alice, 1, 7, 'Z');
  peers.expectConverged(alice, bob);
  alice.room.session.undo();
  peers.expectConverged(alice, bob);
  expect(body(bob)).not.toContain('>Z<');
  alice.room.session.redo();
  peers.expectConverged(alice, bob);
  expectItalicOutside(bob, 'Z');
  const back = await peers.remount(bob);
  peers.expectConverged(alice, back);
  expectItalicOutside(back, 'Z');
});
