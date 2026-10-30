/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The mark at the head of a note follows its renumbering on every peer (issue #1672).
//
// A note cited before an existing one renumbers the existing note while its paragraph stays
// the same. A remote peer receives only the new citation and note, so its notes area must
// repaint the existing note's mark without any change to that note's own paragraph.

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, R, REL, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('note-renumbering', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

type NoteKind = 'footnote' | 'endnote';

/** Two paragraphs, each citing one note: "One." then "Two.". */
function fixture(kind: NoteKind) {
  const cite = (id: number, text: string) =>
    `<w:p><w:r><w:t>${text}</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:${kind}Reference w:id="${id}"/></w:r></w:p>`;
  const note = (id: number, text: string) =>
    `<w:${kind} w:id="${id}"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:${kind}Ref/></w:r><w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p></w:${kind}>`;
  return zipDocument(cite(1, 'Alpha') + cite(2, 'Beta') + '<w:sectPr/>', {
    overrides: `<Override PartName="/word/${kind}s.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}s+xml"/>`,
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/${kind}s" Target="${kind}s.xml"/></Relationships>`,
    extraXml: {
      [`word/${kind}s.xml`]:
        `<w:${kind}s xmlns:w="${W}"><w:${kind} w:type="separator" w:id="-1"><w:p><w:r>` +
        `<w:separator/></w:r></w:p></w:${kind}>${note(1, 'One.')}${note(2, 'Two.')}</w:${kind}s>`,
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
  return { editor, container };
}

/** The painted notes area, one string per note: its mark, then its text. */
function notesArea(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-docx-note]')].map((note) =>
    (note.textContent ?? '').replace(/\s+/g, ' ').trim()
  );
}

/** The painted citation marks in the body, in reading order. */
function citations(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-docx-note-ref]')].map(
    (citation) => citation.textContent ?? ''
  );
}

async function settle(peers: readonly Peer[]): Promise<void> {
  for (const peer of peers) peer.room.session.flushPendingJournals();
  // Layout repaints on the next frame after a remote update lands.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function selectInFirstParagraph(editor: DocxEditorInstance, start: number, end = start) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

// By default, footnotes number 1, 2, 3 and endnotes number i, ii, iii.
const MARKS: Record<NoteKind, readonly string[]> = {
  footnote: ['1', '2', '3'],
  endnote: ['i', 'ii', 'iii'],
};

for (const kind of ['footnote', 'endnote'] as const) {
  const [one, two, three] = MARKS[kind];
  const article = kind === 'endnote' ? 'an' : 'a';
  for (const suggesting of [false, true]) {
    test(`${article} ${kind} cited earlier by a peer renumbers the later note${suggesting ? ' as a suggestion' : ''}`, async () => {
      const pair = await harness.pair(fixture(kind));
      const peers = [pair.alice, pair.bob];
      const alice = mount(pair.alice);
      const bob = mount(pair.bob);
      await settle(peers);
      expect(notesArea(bob.container)).toEqual([`${one} One.`, `${two} Two.`]);

      if (suggesting)
        expect(alice.editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
      // After "Alpha" and its citation: the new note is cited second.
      selectInFirstParagraph(alice.editor, 6);
      expect(alice.editor.exec({ type: 'insertNote', noteKind: kind }).ok).toBe(true);
      await settle(peers);
      for (const peer of [alice, bob]) {
        expect(citations(peer.container)).toEqual([one, two, three]);
        expect(notesArea(peer.container)).toEqual([`${one} One.`, two, `${three} Two.`]);
      }

      // Undo on the peer that inserted it gives the later note its number back everywhere.
      expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
      await settle(peers);
      for (const peer of [alice, bob])
        expect(notesArea(peer.container)).toEqual([`${one} One.`, `${two} Two.`]);
    });
  }

  test(`deleting the first ${kind} citation on a peer renumbers the later note`, async () => {
    const pair = await harness.pair(fixture(kind));
    const peers = [pair.alice, pair.bob];
    const alice = mount(pair.alice);
    const bob = mount(pair.bob);
    await settle(peers);
    // "Alpha" and its citation.
    selectInFirstParagraph(bob.editor, 0, 6);
    expect(bob.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    await settle(peers);
    for (const peer of [alice, bob]) {
      expect(citations(peer.container)).toEqual([one]);
      expect(notesArea(peer.container)).toEqual([`${one} Two.`]);
    }
  });
}
