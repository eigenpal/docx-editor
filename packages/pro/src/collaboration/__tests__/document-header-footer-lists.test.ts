/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A footer list continues the header list of its section. When one peer adds or removes a
// header item while the other edits the footer, both replicas renumber the footer alike, and
// so do undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('header-footer-lists-room', { offlineEditing: true });
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
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
const item = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** Header markers, `|`, footer markers, for the first page. */
function markers(editor: Editor): string {
  const page = editor.surface!.layout().pages[0]!;
  const of = (story: { readonly fragments: readonly unknown[] } | undefined) =>
    (story?.fragments ?? []).flatMap((fragment) => {
      const paragraph = fragment as { kind: string; marker?: { text: string } };
      return paragraph.kind === 'paragraph' && paragraph.marker ? [paragraph.marker.text] : [];
    });
  return [...of(page.header), '|', ...of(page.footer)].join(' ');
}

function coldMarkers(editor: Editor): string {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return markers(cold);
  } finally {
    cold.destroy();
  }
}

async function pair() {
  const peers = await harness.pair(
    zipDocument(
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
        '<w:footerReference w:type="default" r:id="rFooter"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
        'w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
      {
        overrides:
          `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/>` +
          `<Override PartName="/word/footer1.xml" ContentType="${WML}.footer+xml"/>` +
          `<Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/>`,
        documentRels:
          `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/>` +
          `<Relationship Id="rNum" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`,
        extraXml: {
          'word/header1.xml': `<w:hdr xmlns:w="${W}">${item('Head one')}${item('Head two')}</w:hdr>`,
          'word/footer1.xml': `<w:ftr xmlns:w="${W}">${item('Foot one')}${item('Foot two')}</w:ftr>`,
          'word/numbering.xml': NUMBERING,
        },
      }
    )
  );
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
    expect(markers(bob)).toBe(markers(alice));
    for (const editor of [alice, bob]) expect(markers(editor)).toBe(coldMarkers(editor));
    return markers(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

/** Put the caret at the end of `text` inside the header or footer story. */
function caretAfter(editor: Editor, rId: string, text: string): string {
  expect(editor.surface!.setActiveScope({ kind: 'headerFooter', rId })).toBe(true);
  const match = editor.findMatches(text)[0]!;
  const at = { paragraphId: match.blockId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: at, head: at });
  return match.blockId;
}

test('a header item added while a peer types in the footer renumbers the footer', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  expect(converged()).toBe('1. 2. | 3. 4.');

  pause();
  caretAfter(alice, 'rHeader', 'Head two');
  // An empty new item still takes a number.
  alice.surface!.splitParagraph();
  caretAfter(bob, 'rFooter', 'Foot one');
  bob.surface!.type(' typed');
  resume();
  expect(converged()).toBe('1. 2. 3. | 4. 5.');

  alice.surface!.undo();
  expect(converged()).toBe('1. 2. | 3. 4.');
  alice.surface!.redo();
  expect(converged()).toBe('1. 2. 3. | 4. 5.');
});

test('a header item removed while a peer types in the footer renumbers the footer', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  pause();
  const first = caretAfter(bob, 'rHeader', 'Head one');
  const second = bob.findMatches('Head two')[0]!.blockId;
  bob.surface!.setSelection({
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: second, offset: 0 },
  });
  bob.surface!.deleteSelection();
  caretAfter(alice, 'rFooter', 'Foot two');
  alice.surface!.type(' typed');
  resume();
  expect(converged()).toBe('1. | 2. 3.');

  bob.surface!.undo();
  expect(converged()).toBe('1. 2. | 3. 4.');
});
