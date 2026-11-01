/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A kept heading moves with its body paragraph when the body's space after does not fit above
// the note area. When one peer adds a line above them while the other types below, both
// replicas move the pair alike, and so do undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('keep-next-note-area-room', { offlineEditing: true });
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
/** Page height in points. The note area is a 12pt separator and one 12pt note line. */
const PAGE = 100;
const LINE = 12;

const p = (content: string, after = 0, height = LINE, keepNext = false) =>
  `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}` +
  `<w:spacing w:before="0" w:after="${after * 20}" w:line="${height * 20}" w:lineRule="exact"/>` +
  `</w:pPr><w:r>${content}</w:r></w:p>`;

// Opening, spacer, heading and body leave 17pt above the note area: the body's 10pt after
// fits. One more line above leaves 5pt, so the heading and body move together.
const body =
  p('<w:t>Opening</w:t><w:footnoteReference w:id="1"/>') +
  p('<w:t>Spacer</w:t>', 0, PAGE - 24 - 17 - 3 * LINE) +
  p('<w:t>Heading</w:t>', 0, LINE, true) +
  p('<w:t>Body</w:t>', 10) +
  p('<w:t>Next</w:t>') +
  `<w:sectPr><w:pgSz w:w="4000" w:h="${PAGE * 20}"/>` +
  '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>' +
  '</w:sectPr>';

const footnotes =
  `<w:footnotes xmlns:w="${W}">` +
  `<w:footnote w:type="separator" w:id="-1">${p('<w:separator/>')}</w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0">${p('<w:continuationSeparator/>')}</w:footnote>` +
  `<w:footnote w:id="1">${p('<w:t>Note</w:t>')}</w:footnote></w:footnotes>`;

// The current compatibility mode: legacy modes let the body's space after cross the area.
const settings = (mode: number) =>
  `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" ` +
  `w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat></w:settings>`;

const documentBytes = (mode: number) =>
  zipDocument(body, {
    overrides:
      `<Override PartName="/word/footnotes.xml" ContentType="${WML}.footnotes+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="${WML}.settings+xml"/>`,
    documentRels:
      `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/>` +
      `<Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
    extraXml: { 'word/footnotes.xml': footnotes, 'word/settings.xml': settings(mode) },
  });

/** The page index of each named paragraph. */
function summary(editor: Editor): string {
  const pages = editor.surface!.layout().pages;
  const pageOf = (text: string) =>
    pages.findIndex((page) =>
      page.fragments.some(
        (fragment) =>
          fragment.kind === 'paragraph' &&
          fragment.lines.some((line) => line.spans.some((span) => span.text.startsWith(text)))
      )
    );
  return ['Heading', 'Body', 'Next'].map((text) => `${text} ${pageOf(text)}`).join(', ');
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

async function pair(mode = 15) {
  const peers = await harness.pair(documentBytes(mode));
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

test('a line added above a kept heading moves it with its body on both peers', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  expect(converged()).toBe('Heading 0, Body 0, Next 1');

  pause();
  caretAfter(alice, 'Opening');
  alice.surface!.splitParagraph();
  alice.surface!.type('Added');
  caretAfter(bob, 'Next');
  bob.surface!.type(' typed');
  resume();
  expect(converged()).toBe('Heading 1, Body 1, Next 1');

  alice.surface!.undo();
  alice.surface!.undo();
  expect(converged()).toBe('Heading 0, Body 0, Next 1');
  alice.surface!.redo();
  alice.surface!.redo();
  expect(converged()).toBe('Heading 1, Body 1, Next 1');
});

test('in a legacy mode the kept heading and its body keep their page on both peers', async () => {
  const { alice, bob, converged, pause, resume } = await pair(14);
  expect(converged()).toBe('Heading 0, Body 0, Next 1');

  pause();
  caretAfter(alice, 'Opening');
  alice.surface!.splitParagraph();
  alice.surface!.type('Added');
  caretAfter(bob, 'Next');
  bob.surface!.type(' typed');
  resume();
  // The body's space after may cross the area, so only its line has to fit.
  expect(converged()).toBe('Heading 0, Body 0, Next 1');

  alice.surface!.undo();
  alice.surface!.undo();
  expect(converged()).toBe('Heading 0, Body 0, Next 1');
});
