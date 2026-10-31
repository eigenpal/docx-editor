/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A header whose last paragraph has automatic space after reserves that space, so the body
// starts below it. When one peer adds a header paragraph while the other types in the body,
// both replicas keep the body at the same place, and so do undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('header-auto-spacing-room', { offlineEditing: true });
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
const AUTO =
  '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>';
/** The same 14pt after, authored rather than automatic. */
const EXPLICIT = '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="280"/>';
const line = (text: string, spacing = AUTO) =>
  `<w:p><w:pPr>${spacing}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
// Four lines fill the header past the top margin, so its height decides where the body starts.
const header = (last = AUTO) =>
  `<w:hdr xmlns:w="${W}">${line('One')}${line('Two')}${line('Three')}${line('Four', last)}</w:hdr>`;

/** The header's height and where the body's first line starts on the first page. */
function summary(editor: Editor): string {
  const page = editor.surface!.layout().pages[0]!;
  return `header ${page.header!.box.height.toFixed(1)} body ${page.contentBox.y.toFixed(1)}`;
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

const documentWith = (headerXml: string) =>
  zipDocument(
    '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
      '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
      'w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
    {
      overrides: `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/>`,
      documentRels:
        `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/></Relationships>`,
      extraXml: { 'word/header1.xml': headerXml },
    }
  );

/** The summary of a document whose last header line has an authored 14pt space after. */
function explicitSummary(): string {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: documentWith(header(EXPLICIT)),
  });
  try {
    return summary(editor);
  } finally {
    editor.destroy();
  }
}

async function pair() {
  const peers = await harness.pair(documentWith(header()));
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

function caretAfter(editor: Editor, scope: 'header' | 'body', text: string): void {
  const active = scope === 'header' ? { kind: 'headerFooter' as const, rId: 'rHeader' } : null;
  if (active) expect(editor.surface!.setActiveScope(active)).toBe(true);
  const match = editor.findMatches(text)[0]!;
  const at = { paragraphId: match.blockId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: at, head: at });
}

test('a header line added while a peer types in the body moves the body alike', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  const opened = converged();
  // The header reserves its last line's automatic space after, as it would an authored one.
  expect(opened).toBe(explicitSummary());

  pause();
  caretAfter(alice, 'header', 'Four');
  alice.surface!.splitParagraph();
  alice.surface!.type('Five');
  caretAfter(bob, 'body', 'Body');
  bob.surface!.type(' typed');
  resume();
  const grown = converged();
  expect(grown).not.toBe(opened);

  alice.surface!.undo();
  alice.surface!.undo();
  expect(converged()).toBe(opened);
  alice.surface!.redo();
  alice.surface!.redo();
  expect(converged()).toBe(grown);
});

test('deleting the last header lines while a peer types in them converges', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  const opened = converged();
  pause();
  caretAfter(bob, 'header', 'Two');
  const from = bob.findMatches('Two')[0]!;
  const to = bob.findMatches('Four')[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: from.blockId, offset: from.start + from.length },
    head: { paragraphId: to.blockId, offset: to.start + to.length },
  });
  bob.surface!.deleteSelection();
  caretAfter(alice, 'header', 'Four');
  alice.surface!.type(' typed');
  resume();
  const deleted = converged();
  expect(deleted).not.toBe(opened);

  bob.surface!.undo();
  const restored = converged();
  bob.surface!.redo();
  expect(converged()).toBe(deleted);
  bob.surface!.undo();
  expect(converged()).toBe(restored);
});
