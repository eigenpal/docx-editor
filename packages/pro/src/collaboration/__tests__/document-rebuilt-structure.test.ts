/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Content the read rebuilds from a broken shape seeds a room typed, so every peer shows and
// edits it. A run whose `w:rPr` follows a saved `w:lastRenderedPageBreak` seeds with its
// properties first. Concurrent edits inside and around rebuilt content converge, undo and a
// late join agree, and a save writes the rebuilt shape.

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';
import { readCollaborationDocument } from '../document-read.ts';
import { createPeerHarness, nodeText, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('rebuilt-structure-room');

afterEach(() => {
  harness.cleanup();
});

const DOCUMENT = zipDocument(
  '<w:p><w:r><w:lastRenderedPageBreak/><w:rPr><w:b/></w:rPr><w:t>Lead</w:t></w:r>' +
    '<w:r><w:t>Additional words follow</w:t></w:r></w:p><w:sectPr/>'
);
const TEXT = 'LeadAdditional words follow';

function paragraph(peer: Peer): Extract<OoxmlNode, { children: unknown }> {
  const id = harness.paragraphIdAt(peer, 0);
  let found: OoxmlNode | null = null;
  const walk = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.id === id) found = node;
    else node.children.forEach(walk);
  };
  walk(peer.store.bodyStore().part.root);
  if (!found || (found as OoxmlNode).kind === 'textValue') throw new Error('no paragraph');
  return found as Extract<OoxmlNode, { children: unknown }>;
}

/** Every run is typed and its `w:rPr`, when it has one, leads. */
function expectTypedRuns(peer: Peer): void {
  for (const run of paragraph(peer).children) {
    if (run.kind === 'textValue' || run.localName !== 'r') continue;
    expect(run.kind).toBe('run');
    const properties = run.children.flatMap((child, at) =>
      child.kind === 'runProperties' ? [at] : []
    );
    expect(properties.every((at) => at === 0)).toBe(true);
  }
}

function expectHealthy(...peers: Peer[]): void {
  for (const peer of peers) expect(peer.room.session.status()).toBe('ready');
  for (const peer of peers.slice(1)) harness.expectConverged(peers[0]!, peer);
}

describe('a run whose w:rPr follows a saved page break', () => {
  test('every peer shows its text in a typed run', async () => {
    const { alice, bob } = await harness.pair(DOCUMENT);
    expectHealthy(alice, bob);
    expect(nodeText(paragraph(alice))).toBe(TEXT);
    expect(nodeText(paragraph(bob))).toBe(TEXT);
    expectTypedRuns(alice);
    expectTypedRuns(bob);
  });

  test('concurrent edits inside and after it converge, undo, and survive a late join', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 1, text: 'A' },
    ]);
    harness.apply(bob, [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(bob, 0), start: 4, end: 15 },
    ]);
    resume();
    expectHealthy(alice, bob);
    expect(nodeText(paragraph(alice))).toBe('LAeadwords follow');
    expectTypedRuns(alice);
    alice.room.session.undo();
    expectHealthy(alice, bob);
    expect(nodeText(paragraph(bob))).toBe('Leadwords follow');
    const late = await harness.join(bob, 'late');
    expectHealthy(alice, bob, late);
    expect(nodeText(paragraph(late))).toBe('Leadwords follow');
  });

  test('deleting its text while another peer types into it converges', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    harness.apply(alice, [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(alice, 0), start: 0, end: 4 },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 2, text: 'B' },
    ]);
    resume();
    expectHealthy(alice, bob);
    expect(nodeText(paragraph(alice))).toBe('BAdditional words follow');
    expectTypedRuns(alice);
  });

  test('a save writes the properties first and reopens with the text', async () => {
    const { alice, bob } = await harness.pair(DOCUMENT);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 4, text: 'x' },
    ]);
    expectHealthy(alice, bob);
    const bytes = readCollaborationDocument(alice.ydoc);
    // The written XML itself, not a reread, which would move the properties first again.
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:lastRenderedPageBreak/><w:t>Leadx</w:t>');
    const reopened = readOoxmlPackage(bytes);
    if (!reopened.ok) throw new Error(reopened.reason);
    const body = reopened.package.parts.get(reopened.package.mainDocumentPart)!.root;
    const runs: OoxmlNode[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'r') runs.push(node);
      node.children.forEach(walk);
    };
    walk(body);
    expect(runs.map((run) => run.kind)).not.toContain('generic');
    expect(runs.map(nodeText).join('')).toBe('LeadxAdditional words follow');
  });
});

// A run whose second `w:rPr` follows its text seeds as two runs, a paragraph whose `w:pPr`
// follows its text seeds with an empty leading one, and a table with two `w:tblPr` seeds with
// one. Peers edit across those parts and agree.
const REBUILT = zipDocument(
  '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Alpha </w:t><w:rPr><w:b/></w:rPr>' +
    '<w:t>Beta</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Late</w:t></w:r><w:pPr><w:jc w:val="right"/></w:pPr></w:p>' +
    '<w:tbl><w:tblPr><w:jc w:val="right"/></w:tblPr><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p>' +
    '</w:tc></w:tr></w:tbl><w:sectPr/>'
);

function paragraphTexts(peer: Peer): (string | null)[] {
  return [0, 1, 2].map((index) => {
    const id = harness.paragraphIdAt(peer, index);
    let found: OoxmlNode | null = null;
    const walk = (node: OoxmlNode): void => {
      if (found || node.kind === 'textValue') return;
      if (node.id === id) found = node;
      else node.children.forEach(walk);
    };
    walk(peer.store.bodyStore().part.root);
    return found ? nodeText(found) : null;
  });
}

describe('rebuilt runs, paragraphs and tables', () => {
  test('seed typed on every peer and converge under edits across their parts', async () => {
    const { alice, bob, pause, resume } = await harness.pair(REBUILT);
    expectHealthy(alice, bob);
    expect(paragraphTexts(bob)).toEqual(['Alpha Beta', 'Late', 'Cell']);
    pause();
    // Across the boundary between the two runs, and into the other paragraphs.
    harness.apply(alice, [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(alice, 0), start: 3, end: 8 },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 6, text: 'X' },
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 4, text: 'r' },
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 2), offset: 0, text: 'A ' },
    ]);
    resume();
    expectHealthy(alice, bob);
    expect(paragraphTexts(alice)).toEqual(paragraphTexts(bob));
    expect(paragraphTexts(alice).slice(1)).toEqual(['Later', 'A Cell']);
    bob.room.session.undo();
    expectHealthy(alice, bob);
    const late = await harness.join(alice, 'late');
    expectHealthy(alice, bob, late);
    expect(paragraphTexts(late)).toEqual(paragraphTexts(alice));
  });
});
