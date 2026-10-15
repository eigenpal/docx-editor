/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Saves reuse the written form of paragraphs and table rows from earlier saves, and a save in
// progress keeps the document it captured. Two collaborating editors must still save the same
// bytes after concurrent edits, a deletion, an undo, and a remote edit that lands mid-save.
import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('incremental-save-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
const BODY =
  paragraph('Alpha') +
  paragraph('Bravo') +
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>` +
  `<w:tr>${cell('Cell one')}</w:tr><w:tr>${cell('Cell two')}</w:tr></w:tbl>` +
  paragraph('Charlie') +
  '<w:sectPr/>';

async function room() {
  const peers = await harness.pair(zipDocument(BODY));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const caretAt = (editor: Editor, index: number, offset: number) => {
    const paragraphId = editor.surface!.session.paragraphIds()[index]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  };
  return { alice, bob, sync, caretAt };
}

function documentXml(bytes: Uint8Array | ArrayBuffer): string {
  return strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml']!);
}

/** Both peers save, agree, and match what a save of the reopened file writes. */
async function expectSameSaves(alice: Editor, bob: Editor): Promise<string> {
  const [left, right] = await Promise.all([alice.save(), bob.save()]);
  const xml = documentXml(left);
  expect(documentXml(right)).toBe(xml);
  const reopened = readOoxmlPackage(new Uint8Array(left));
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(documentXml(writeOoxmlPackage(reopened.package))).toBe(xml);
  return xml;
}

test('peers save the same bytes through concurrent edits, deletion, and undo', async () => {
  const { alice, bob, sync, caretAt } = await room();
  // The first saves leave every paragraph and row written once.
  await expectSameSaves(alice, bob);

  caretAt(alice, 0, 5);
  alice.surface!.type(' one');
  caretAt(bob, 2, 8);
  bob.surface!.type(' edited');
  sync();
  let xml = await expectSameSaves(alice, bob);
  expect(xml).toContain('Alpha one');
  expect(xml).toContain('Cell one edited');

  // Bob deletes a paragraph's text while Alice types in another one.
  const bravo = bob.surface!.session.paragraphIds()[1]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: bravo, offset: 0 },
    head: { paragraphId: bravo, offset: 5 },
  });
  bob.surface!.deleteSelection();
  caretAt(alice, 4, 7);
  alice.surface!.type(' two');
  sync();
  xml = await expectSameSaves(alice, bob);
  expect(xml).not.toContain('Bravo');
  expect(xml).toContain('Charlie two');

  alice.surface!.undo();
  sync();
  xml = await expectSameSaves(alice, bob);
  expect(xml).toContain('>Charlie<');
  expect(xml).toContain('Alpha one');
});

test('a save in progress keeps its document when a remote edit arrives', async () => {
  const { alice, bob, sync, caretAt } = await room();
  await expectSameSaves(alice, bob);

  // A local edit first, so this save has work to do rather than repeating the last result.
  caretAt(alice, 4, 7);
  alice.surface!.type(' local');
  const steps = alice.surface!.saveSteps();
  let next = steps.next();
  expect(next.done).toBe(false);
  caretAt(bob, 0, 5);
  bob.surface!.type(' remote');
  sync();
  expect(alice.surface!.session.storyText({ kind: 'body' })).toContain('Alpha remote');

  while (!next.done) next = steps.next();
  const captured = documentXml(next.value);
  expect(captured).toContain('Charlie local');
  expect(captured).not.toContain('Alpha remote');
  const xml = await expectSameSaves(alice, bob);
  expect(xml).toContain('Alpha remote');
  expect(xml).toContain('Charlie local');
});
