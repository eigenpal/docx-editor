/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A pasted list keeps the level text, marker format, bullet glyph, and indents of its
// `@list` rules on every replica: while the other participant edits the same list, when both
// paste at once, and after undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('paste-list-levels-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
const item = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

const WORD_HTML =
  '<html><head><style>' +
  '@list l0:level1 {mso-level-text:"%1\\)";margin-left:54.0pt;text-indent:-27.0pt;' +
  'color:red;mso-ansi-font-weight:bold;}\n' +
  '@list l1:level1 {mso-level-number-format:bullet;mso-level-text:;' +
  'margin-left:45.0pt;text-indent:-22.5pt;font-family:Wingdings;}' +
  '</style></head><body>' +
  '<p style="margin-left:54.0pt;text-indent:-27.0pt;mso-list:l0 level1 lfo1">' +
  '<b><span style="color:red"><span style="mso-list:Ignore">1)<span>&nbsp;</span></span></span></b>' +
  'Alpha</p>' +
  '<p style="margin-left:45.0pt;text-indent:-22.5pt;mso-list:l1 level1 lfo2">' +
  '<span style="font-family:Wingdings"><span style="mso-list:Ignore">Ø<span>&nbsp;</span>' +
  '</span></span>Bravo</p></body></html>';

function markersOf(editor: Editor): string[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' && fragment.marker
          ? [`${fragment.marker.text}|${fragment.marker.box.x}`]
          : []
      )
    );
}

function coldMarkersOf(editor: Editor): string[] {
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
    zipDocument(item('one') + item('two') + '<w:p><w:r><w:t>end</w:t></w:r></w:p><w:sectPr/>', {
      overrides:
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
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
  const converged = (): string => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(markersOf(bob)).toEqual(markersOf(alice));
    for (const editor of [alice, bob]) expect(markersOf(editor)).toEqual(coldMarkersOf(editor));
    return serializeOoxmlPart(right.parts.get('/word/numbering.xml')!);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

const caret = (editor: Editor, index: number, offset: number) => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
};

const pastedLevels = (numbering: string): void => {
  expect(numbering).toContain('<w:lvlText w:val="%1)"/>');
  expect(numbering).toContain('<w:b/><w:color w:val="FF0000"/>');
  expect(numbering).toMatch(/<w:ind (?=[^>]*w:left="1080")(?=[^>]*w:hanging="540")/);
  expect(numbering).toContain('<w:lvlText w:val=""/>');
  expect(numbering).toContain('<w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/>');
};

test('a pasted list keeps its levels while the peer edits the same list', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  converged();

  pause();
  caret(alice, 1, 3);
  expect(alice.surface!.pasteRich('Alpha\nBravo', WORD_HTML)).toBe(true);
  caret(bob, 0, 3);
  bob.surface!.splitParagraph();
  resume();
  pastedLevels(converged());
  expect(markersOf(alice).map((marker) => marker.split('|')[0])).toContain('1)');

  alice.surface!.undo();
  expect(converged()).not.toContain('%1)');
  alice.surface!.redo();
  pastedLevels(converged());
});

test('two peers pasting the same list at once keep separate numbering', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  pause();
  caret(alice, 1, 3);
  expect(alice.surface!.pasteRich('Alpha\nBravo', WORD_HTML)).toBe(true);
  caret(bob, 2, 3);
  expect(bob.surface!.pasteRich('Alpha\nBravo', WORD_HTML)).toBe(true);
  resume();
  const numbering = converged();
  pastedLevels(numbering);
  // Each paste minted its own two lists over its own definitions.
  expect(numbering.match(/<w:lvlText w:val="%1\)"\/>/g)).toHaveLength(2);
});
