/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Footnote pages do not depend on edit history (issue #1761).
//
// Each peer lays out its own copy of the shared document, and the two peers see the edits in
// different orders: a local edit lands first on its own peer. The footnote reserves of a page
// and its body decide each other, so a search that started from the previous answer could
// settle on a different set of pages on each peer, and on a third set when the saved document
// opens fresh. Both peers and a fresh open must show the same pages and note areas.

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, R, REL, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('footnote-layout-history', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const PARAGRAPHS = 36;

/** A small page with many paragraphs; every third one cites a note of three to six lines. */
function fixture(): Uint8Array {
  const notes: string[] = [];
  const body: string[] = [];
  for (let i = 0; i < PARAGRAPHS; i += 1) {
    const words = Array.from({ length: 6 + ((i * 7) % 19) }, (_, k) => `w${i}x${k}`).join(' ');
    let cite = '';
    if (i % 3 === 1) {
      const id = notes.length + 1;
      const noteWords = Array.from({ length: 12 + ((i * 5) % 4) * 8 }, (_, k) => `n${id}x${k}`);
      notes.push(
        `<w:footnote w:id="${id}"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
          `<w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${noteWords.join(' ')}</w:t>` +
          '</w:r></w:p></w:footnote>'
      );
      cite =
        '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' +
        `<w:footnoteReference w:id="${id}"/></w:r>`;
    }
    const widow = i % 2 === 0 ? '' : '<w:widowControl w:val="0"/>';
    body.push(
      `<w:p><w:pPr>${widow}<w:spacing w:after="${(i % 3) * 60}"/></w:pPr>` +
        `<w:r><w:t xml:space="preserve">${words}</w:t></w:r>${cite}</w:p>`
    );
  }
  const section =
    '<w:sectPr><w:pgSz w:w="6000" w:h="6400"/>' +
    '<w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360" w:header="0" w:footer="0"/>' +
    '</w:sectPr>';
  return zipDocument(body.join('') + section, {
    overrides:
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    extraXml: {
      'word/footnotes.xml':
        `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `${notes.join('')}</w:footnotes>`,
    },
  });
}

function mount(peer: Peer) {
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    author: 'Writer',
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return editor;
}

async function until(done: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !done(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settle(peers: readonly Peer[]): Promise<void> {
  for (const peer of peers) peer.room.session.flushPendingJournals();
  // Layout repaints on the next frame after a remote update lands.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * Each page as its first and last body line and its notes, with `c` on a continuation. Text,
 * not ids: a fresh open gives new paragraphs new ids.
 */
function pages(editor: DocxEditorInstance): string[] {
  return editor.surface!.layout().pages.map((page) => {
    const lines = page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
        : []
    );
    const notes = (page.footnotes?.notes ?? []).map(
      (note) => `${note.noteId}${note.continuation ? 'c' : ''}`
    );
    return `${lines[0] ?? '-'} .. ${lines.at(-1) ?? '-'} | ${notes.join(' ')}`;
  });
}

function select(editor: DocxEditorInstance, index: number, start: number, end = start) {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

async function expectFreshOpenMatches(editor: DocxEditorInstance): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const fresh = createDocxEditor({ container, document: new Uint8Array(await editor.save()) });
  editors.push(fresh);
  await until(() => !!fresh.surface);
  expect(pages(fresh)).toEqual(pages(editor));
}

test('concurrent edits give both peers and a fresh open the same footnote pages', async () => {
  const pair = await harness.pair(fixture());
  const peers = [pair.alice, pair.bob];
  const alice = mount(pair.alice);
  const bob = mount(pair.bob);
  await settle(peers);
  expect(pages(alice).length).toBeGreaterThan(4);
  expect(pages(bob)).toEqual(pages(alice));

  const phrase = 'a phrase long enough to move a line ';
  for (let round = 0; round < 4; round += 1) {
    // Concurrent: each peer lays out its own edit before it sees the other one.
    pair.pause();
    select(alice, 1 + round * 2, 0);
    expect(alice.exec({ type: 'insertText', text: phrase }).ok).toBe(true);
    select(bob, PARAGRAPHS - 8 - round * 3, 0, 12);
    expect(bob.exec({ type: 'deleteText' }).ok).toBe(true);
    await settle(peers);
    pair.resume();
    await settle(peers);
    harness.expectConverged(pair.alice, pair.bob);
    expect(pages(bob)).toEqual(pages(alice));
  }
  await expectFreshOpenMatches(alice);

  // Undo and redo on one peer move the pages back and forth on both.
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  await settle(peers);
  expect(pages(bob)).toEqual(pages(alice));
  await expectFreshOpenMatches(bob);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  await settle(peers);
  expect(pages(bob)).toEqual(pages(alice));
  await expectFreshOpenMatches(alice);
}, 20000);

test('deleting a cited paragraph while the other peer types in it keeps the pages equal', async () => {
  const pair = await harness.pair(fixture());
  const peers = [pair.alice, pair.bob];
  const alice = mount(pair.alice);
  const bob = mount(pair.bob);
  await settle(peers);

  pair.pause();
  // Paragraph 4 cites note 2. Bob types in it while Alice deletes it with its citation.
  select(bob, 4, 3);
  expect(bob.exec({ type: 'insertText', text: 'more words in the cited paragraph ' }).ok).toBe(
    true
  );
  const ids = alice.surface!.session.paragraphIds();
  alice.surface!.setSelection({
    anchor: { paragraphId: ids[4]!, offset: 0 },
    head: { paragraphId: ids[5]!, offset: 0 },
  });
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  await settle(peers);
  pair.resume();
  await settle(peers);
  harness.expectConverged(pair.alice, pair.bob);
  expect(pages(bob)).toEqual(pages(alice));
  await expectFreshOpenMatches(bob);
}, 20000);
