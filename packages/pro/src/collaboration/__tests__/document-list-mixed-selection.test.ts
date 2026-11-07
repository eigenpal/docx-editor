/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A list button over list items and plain paragraphs together. A selection that starts with a
// plain paragraph below an item joins that list, its items at the paragraph's level; any
// other mix starts a list of its own. Both writes replicate beside a peer's typing, a peer's
// deletion of a selected paragraph, a peer's own press, undo and redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('list-mixed-selection-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** numId 2: a decimal list, "%1." through "%9.". */
let LEVELS = '';
for (let level = 0; level < 9; level += 1) {
  LEVELS +=
    `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
    `<w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${720 + 360 * level}" w:hanging="360"/></w:pPr></w:lvl>`;
}
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">${LEVELS}</w:abstractNum>` +
  '<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string, level: number) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="2"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** One list item above a plain paragraph and a level-2 item, then a plain paragraph. */
const PLAIN_FIRST = item('Above', 0) + plain('Plain') + item('Item', 2) + plain('After');
/** One list item above a level-2 item and a plain paragraph, then a plain paragraph. */
const ITEM_FIRST = item('Above', 0) + item('Item', 2) + plain('Plain') + plain('After');

/** Each paragraph's list as `numId/level`, the authored list as `2`, a new one as `new`. */
function listsOf(editor: Editor): string[] {
  const xml = strFromU8(unzipSync(editor.surface!.session.save())['word/document.xml']!);
  return (xml.match(/<w:p[ >].*?<\/w:p>/g) ?? []).map((paragraph) => {
    const numId = /<w:numId w:val="(\d+)"\/>/.exec(paragraph)?.[1];
    if (!numId) return '-';
    const level = /<w:ilvl w:val="(\d+)"\/>/.exec(paragraph)?.[1] ?? '0';
    return `${numId === '2' ? '2' : 'new'}/${level}`;
  });
}

function markersOf(editor: Editor): (string | null)[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? [fragment.marker?.text ?? null] : []
      )
    );
}

function coldMarkersOf(editor: Editor): (string | null)[] {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return markersOf(cold);
  } finally {
    cold.destroy();
  }
}

async function pairedEditors(body: string) {
  const peers = await harness.pair(
    zipDocument(body, {
      overrides: `<Override PartName="/word/numbering.xml" ContentType="${MAIN}.numbering+xml"/>`,
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdNum" Type="${REL}/numbering" Target="numbering.xml"/></Relationships>`,
      extraXml: { 'word/numbering.xml': NUMBERING },
    })
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const converged = (): string[] => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(listsOf(bob)).toEqual(listsOf(alice));
    expect(markersOf(bob)).toEqual(markersOf(alice));
    for (const editor of [alice, bob]) expect(markersOf(editor)).toEqual(coldMarkersOf(editor));
    return listsOf(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

/** Select paragraphs `from` through `to`. */
function select(editor: Editor, from: number, to: number): void {
  const ids = editor.surface!.session.paragraphIds();
  editor.surface!.setSelection({
    anchor: { paragraphId: ids[from]!, offset: 0 },
    head: { paragraphId: ids[to]!, offset: 1 },
  });
}

const caret = (editor: Editor, index: number, offset = 0) => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
};

test('a join beside typing in the moved item, with undo and redo', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors(PLAIN_FIRST);
  const original = converged();
  expect(original).toEqual(['2/0', '-', '2/2', '-']);
  pause();
  select(alice, 1, 2);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  caret(bob, 2);
  bob.surface!.insertPlainText('x');
  resume();
  const joined = ['2/0', '2/0', '2/0', '-'];
  expect(converged()).toEqual(joined);
  expect(markersOf(alice)).toEqual(['1.', '2.', '3.', null]);
  alice.surface!.undo();
  expect(converged()).toEqual(original);
  alice.surface!.redo();
  expect(converged()).toEqual(joined);
});

test('a join converges while the peer deletes the plain paragraph it starts with', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors(PLAIN_FIRST);
  pause();
  select(alice, 1, 2);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  // Bob deletes from the end of Above through the start of Item, taking Plain with it.
  const ids = bob.surface!.session.paragraphIds();
  bob.surface!.setSelection({
    anchor: { paragraphId: ids[0]!, offset: 5 },
    head: { paragraphId: ids[2]!, offset: 0 },
  });
  bob.surface!.deleteSelection();
  resume();
  const settled = converged();
  expect(settled).toHaveLength(2);
  expect(settled[1]).toBe('-');
});

test('a new list beside the peer pressing the list button on the paragraph after it', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors(ITEM_FIRST);
  pause();
  select(alice, 1, 2);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  caret(bob, 3);
  expect(bob.surface!.toggleList('bullet')).toBe(true);
  resume();
  const settled = converged();
  expect(settled.slice(0, 3)).toEqual(['2/0', 'new/2', 'new/0']);
  expect(settled[3]).toBe('new/0');
  alice.surface!.undo();
  expect(converged().slice(0, 3)).toEqual(['2/0', '2/2', '-']);
  alice.surface!.redo();
  expect(converged().slice(0, 3)).toEqual(['2/0', 'new/2', 'new/0']);
});
