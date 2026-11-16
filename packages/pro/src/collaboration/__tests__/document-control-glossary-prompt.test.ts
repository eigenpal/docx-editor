/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A text control one peer empties shows its glossary prompt on every peer.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('control-glossary-prompt', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

function mount(options: Parameters<typeof createDocxEditor>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ ...options, container });
  editors.push(editor);
  return editor;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const GLOSSARY =
  `<w:glossaryDocument xmlns:w="${W}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="Empty"/>` +
  '<w:category><w:name w:val="General"/><w:gallery w:val="placeholder"/></w:category></w:docPartPr>' +
  '<w:docPartBody><w:p><w:r><w:t>Enter a value</w:t></w:r></w:p></w:docPartBody></w:docPart>' +
  '</w:docParts></w:glossaryDocument>';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const DOCUMENT =
  '<w:p>' +
  run('A ') +
  '<w:sdt><w:sdtPr><w:tag w:val="value"/><w:placeholder><w:docPart w:val="Empty"/></w:placeholder>' +
  '<w:text/></w:sdtPr><w:sdtContent>' +
  run('value') +
  '</w:sdtContent></w:sdt>' +
  run(' B') +
  '</w:p>';

test('an emptied control shows its glossary prompt on every peer, and undo restores it', async () => {
  const pair = await harness.pair(
    zipDocument(DOCUMENT, {
      overrides:
        '<Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/>',
      documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${R}/glossaryDocument" Target="glossary/document.xml"/></Relationships>`,
      extraXml: { 'word/glossary/document.xml': GLOSSARY },
    })
  );
  const [alice, bob] = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Editor, Editor];
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
  };

  pair.pause();
  const range = alice.surface!.layout().contentControls![0]!.range!;
  alice.surface!.setSelection({
    anchor: { paragraphId: range.paragraphId, offset: range.start },
    head: { paragraphId: range.paragraphId, offset: range.end },
  });
  alice.surface!.deleteBackward();
  const paragraphId = bob.surface!.session.paragraphIds()[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId, offset: 9 },
    head: { paragraphId, offset: 9 },
  });
  bob.surface!.type('!');
  flush();
  pair.resume();
  converge();
  expect(bob.surface!.session.bodyText()).toBe('A Enter a value B!');

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.surface!.session.bodyText()).toBe('A value B!');
});
