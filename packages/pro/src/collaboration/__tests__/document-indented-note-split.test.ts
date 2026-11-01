/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Indented body text admits a footnote that splits across pages, as full-width text does. When
// one peer adds a line above the citing paragraph while the other types below it, both replicas
// place the note alike, and so do undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('indented-note-split-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  harness.cleanup();
});

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
/** Page height in points. The separator and each note line are 12pt. */
const PAGE = 100;
const LINE = 12;
const INDENT = '<w:ind w:left="720" w:right="360"/>';

const p = (content: string, height = LINE, props = INDENT) =>
  `<w:p><w:pPr>${props}` +
  `<w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/>` +
  `</w:pPr><w:r>${content}</w:r></w:p>`;

// Opening, spacer and the citing line leave 40pt: the separator and two of the note's four
// lines. One more line above leaves 28pt, too little for a two-line opening.
const body =
  p('<w:t>Opening</w:t>') +
  p('<w:t>Spacer</w:t>', 36) +
  p('<w:t>Cited</w:t><w:footnoteReference w:id="1"/>') +
  p('<w:t>Next</w:t>') +
  `<w:sectPr><w:pgSz w:w="4000" w:h="${PAGE * 20}"/>` +
  '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>' +
  '</w:sectPr>';

const noteLines = ['One', 'Two', 'Three', 'Four']
  .map((text, index) => `${index ? '<w:br/>' : ''}<w:t>Note ${text}</w:t>`)
  .join('');
const footnotes =
  `<w:footnotes xmlns:w="${W}">` +
  `<w:footnote w:type="separator" w:id="-1">${p('<w:separator/>', LINE, '')}</w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0">${p('<w:continuationSeparator/>', LINE, '')}</w:footnote>` +
  `<w:footnote w:id="1">${p(noteLines, LINE, '')}</w:footnote></w:footnotes>`;

const documentBytes = () =>
  zipDocument(body, {
    overrides: `<Override PartName="/word/footnotes.xml" ContentType="${WML}.footnotes+xml"/>`,
    documentRels:
      `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    extraXml: { 'word/footnotes.xml': footnotes },
  });

/** The citing paragraph's page and the note lines on each page. */
function summary(editor: Editor): string {
  const pages = editor.surface!.layout().pages;
  const cited = pages.findIndex((page) =>
    page.fragments.some(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((line) => line.spans.some((span) => span.text.startsWith('Cited')))
    )
  );
  const notes = pages.map((page) =>
    (page.footnotes?.notes ?? []).reduce(
      (count, note) =>
        count +
        note.fragments.reduce((n, f) => n + (f.kind === 'paragraph' ? f.lines.length : 0), 0),
      0
    )
  );
  return `Cited ${cited}, notes ${notes.join(' ')}`;
}

function coldSummary(editor: Editor): string {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return summary(cold);
  } finally {
    cold.destroy();
  }
}

async function pair() {
  const peers = await harness.pair(documentBytes());
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const converged = (): string => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(summary(bob)).toBe(summary(alice));
    for (const editor of [alice, bob]) expect(summary(editor)).toBe(coldSummary(editor));
    return summary(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

function caretAfter(editor: Editor, text: string): void {
  const match = editor.findMatches(text)[0]!;
  const at = { paragraphId: match.blockId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: at, head: at });
}

test('a line added above an indented citing paragraph places its note alike', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  const opened = converged();
  // The note splits two and two below the citing line, as it would beside full-width text.
  expect(opened).toBe('Cited 0, notes 2 2');

  pause();
  caretAfter(alice, 'Opening');
  alice.surface!.splitParagraph();
  alice.surface!.type('Added');
  caretAfter(bob, 'Next');
  bob.surface!.type(' typed');
  resume();
  const grown = converged();
  // Too little room is left for a two-line opening, so the citing line and its note move on.
  expect(grown).toBe('Cited 1, notes 0 4');

  alice.surface!.undo();
  alice.surface!.undo();
  expect(converged()).toBe(opened);
  alice.surface!.redo();
  alice.surface!.redo();
  expect(converged()).toBe(grown);
});
