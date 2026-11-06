/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A list button starts a list on a definition of its own, never on the document's heading
// numbering, and a paragraph just below a heading joins the heading list by taking the
// heading style. Both writes replicate: concurrent presses, an edit and a deletion of the
// pressed paragraph, undo and redo, and a cold reopen all converge.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('list-heading-numbering-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** numId 1: "0%1" / "0%1.%2" linked to Heading 1 and 2. numId 2: an unused plain list. */
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading1"/>' +
  '<w:lvlText w:val="0%1"/><w:lvlJc w:val="left"/><w:rPr><w:sz w:val="40"/></w:rPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading2"/>' +
  '<w:lvlText w:val="0%1.%2"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';

const heading = (id: string, level: number) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="heading ${level + 1}"/>` +
  `<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/>` +
  `</w:numPr><w:outlineLvl w:val="${level}"/></w:pPr></w:style>`;

const STYLES =
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/></w:style>${heading('Heading1', 0)}${heading('Heading2', 1)}</w:styles>`;

const paragraph = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const BODY =
  paragraph('Introduction', 'Heading1') +
  paragraph('Intro') +
  paragraph('Gap') +
  paragraph('First') +
  paragraph('Second') +
  paragraph('Scope', 'Heading2');

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

async function pairedEditors() {
  const peers = await harness.pair(
    zipDocument(BODY, {
      overrides:
        `<Override PartName="/word/numbering.xml" ContentType="${MAIN}.numbering+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="${MAIN}.styles+xml"/>`,
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdNum" Type="${REL}/numbering" Target="numbering.xml"/>` +
        `<Relationship Id="rIdSty" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
      extraXml: { 'word/numbering.xml': NUMBERING, 'word/styles.xml': STYLES },
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
  const converged = (): (string | null)[] => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(markersOf(bob)).toEqual(markersOf(alice));
    for (const editor of [alice, bob]) expect(markersOf(editor)).toEqual(coldMarkersOf(editor));
    return markersOf(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

const caret = (editor: Editor, index: number, offset = 1) => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
};

/** Scope after the join and the concurrent delete: the joined paragraph is gone, so 01.1. */
const SETTLED_SCOPE = '01.1';
const ORIGINAL = ['01', null, null, null, null, '01.1'];

test('concurrent presses: a plain list and a joined heading converge', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  expect(converged()).toEqual(ORIGINAL);

  pause();
  caret(alice, 3);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  caret(bob, 1);
  expect(bob.surface!.toggleList('ordered')).toBe(true);
  resume();
  expect(converged()).toEqual(['01', '02', null, '1.', null, '02.1']);

  alice.surface!.undo();
  expect(converged()).toEqual(['01', '02', null, null, null, '02.1']);
  bob.surface!.undo();
  expect(converged()).toEqual(ORIGINAL);
  bob.surface!.redo();
  alice.surface!.redo();
  expect(converged()).toEqual(['01', '02', null, '1.', null, '02.1']);
});

test('both peers start separate plain lists at once', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  pause();
  caret(alice, 3);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  caret(bob, 4);
  expect(bob.surface!.toggleList('bullet')).toBe(true);
  resume();
  const markers = converged();
  expect(markers.slice(0, 3)).toEqual(['01', null, null]);
  expect(markers[3]).toBe('1.');
  expect(markers[4]).not.toBeNull();
  expect(markers[5]).toBe('01.1');
});

test('a join converges while the peer types in the joined paragraph', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  pause();
  caret(alice, 1);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  caret(bob, 1, 0);
  bob.surface!.insertPlainText('x');
  resume();
  expect(converged()).toEqual(['01', '02', null, null, null, '02.1']);
});

test('a join converges while the peer deletes the joined paragraph', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  pause();
  caret(alice, 1);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  // Bob deletes from the end of the heading through the start of Gap, taking Intro with it.
  const ids = bob.surface!.session.paragraphIds();
  bob.surface!.setSelection({
    anchor: { paragraphId: ids[0]!, offset: 12 },
    head: { paragraphId: ids[2]!, offset: 0 },
  });
  bob.surface!.deleteSelection();
  resume();
  const settled = converged();
  expect(settled[0]).toBe('01');
  expect(settled.at(-1)).toBe(SETTLED_SCOPE);
  alice.surface!.undo();
  expect(converged().at(-1)).toBe('01.1');
});
