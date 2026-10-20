/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, R, REL } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('rtl-decimal-atoms', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
const before = 'אחת שתיים שלוש ';
const after = ' ארבע חמש שש';
const run = (text: string, rtl = true) =>
  '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' +
  `<w:sz w:val="24"/><w:szCs w:val="24"/>${rtl ? '<w:rtl/>' : ''}</w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

function fixture(kind: 'PAGE' | 'footnote') {
  const atom =
    kind === 'PAGE'
      ? `<w:fldSimple w:instr="PAGE">${run('12', false)}</w:fldSimple>`
      : '<w:r><w:footnoteReference w:id="1"/></w:r>';
  return zipDocument(
    `<w:p><w:pPr><w:bidi/></w:pPr>${run(before)}${atom}${run(after)}</w:p>`,
    kind === 'footnote'
      ? {
          overrides:
            '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
          documentRels:
            `<Relationships xmlns="${REL}"><Relationship Id="notes" Type="${R}/footnotes" ` +
            'Target="footnotes.xml"/></Relationships>',
          extraXml: {
            'word/footnotes.xml':
              `<w:footnotes xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
              '<w:footnote w:id="1"><w:p w14:paraId="12345678" w14:textId="12345678">' +
              '<w:r><w:footnoteRef/></w:r><w:r><w:t>Note</w:t></w:r></w:p></w:footnote></w:footnotes>',
          },
        }
      : undefined
  );
}

function mount(options: Parameters<typeof createDocxEditor>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ ...options, container });
  editors.push(editor);
  return { editor, container };
}

function caret(editor: Editor, offset: number) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const position = { paragraphId, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
  return position;
}

function checkLayout(editor: Editor) {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const paragraph = surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .find((fragment) => fragment.kind === 'paragraph' && fragment.paragraphId === paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('Missing paragraph');
  const spans = paragraph.lines.flatMap((line) => line.spans);
  const atom = spans.find((span) => span.fieldAtom || span.noteNav);
  expect(atom).toBeDefined();
  expect(atom!.text).toMatch(/^[0-9]+$/);
  expect(atom!.range.end - atom!.range.start).toBe(1);
  const positions = ['אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש'].map((word) => {
    const span = spans.find((candidate) => candidate.text.includes(word));
    expect(span).toBeDefined();
    return span!.box.x;
  });
  for (let index = 1; index < positions.length; index++) {
    expect(positions[index - 1]!).toBeGreaterThan(positions[index]!);
  }
}

async function pair(kind: 'PAGE' | 'footnote') {
  const peers = await harness.pair(fixture(kind));
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  });
  const [alice, bob] = mounted as [ReturnType<typeof mount>, ReturnType<typeof mount>];
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.editor.surface!.session.currentPackage();
    const right = bob.editor.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };
  return { peers, alice, bob, converge };
}

for (const kind of ['PAGE', 'footnote'] as const) {
  test(`RTL ASCII-decimal ${kind} retains word order after concurrent edits, undo, and reopen`, async () => {
    const { peers, alice, bob, converge } = await pair(kind);
    checkLayout(alice.editor);
    checkLayout(bob.editor);
    peers.pause();
    caret(alice.editor, 0);
    expect(alice.editor.exec({ type: 'insertText', text: 'חדש ' }).ok).toBe(true);
    caret(bob.editor, before.length + 1 + after.length);
    expect(bob.editor.exec({ type: 'insertText', text: ' סוף' }).ok).toBe(true);
    peers.resume();
    converge();
    checkLayout(alice.editor);
    checkLayout(bob.editor);

    expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
    converge();
    checkLayout(bob.editor);
    expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
    converge();
    checkLayout(bob.editor);

    const position = caret(alice.editor, before.length + 5);
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.awareness.clientID]),
      'test-provider'
    );
    expect(peers.bob.room.session.remoteSelections()).toMatchObject([
      { anchor: { offset: position.offset }, head: { offset: position.offset } },
    ]);
    expect(bob.container.querySelector('.docx-remote-caret')).not.toBeNull();

    const reopened = mount({ document: new Uint8Array(await bob.editor.save()) });
    checkLayout(reopened.editor);
    expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(bob.editor.surface!.session.currentPackage())
    );
  });

  test(`deleting an ASCII-decimal ${kind} atom during remote typing converges`, async () => {
    const { peers, alice, bob, converge } = await pair(kind);
    peers.pause();
    caret(alice.editor, before.length + 1);
    alice.editor.surface!.deleteBackward();
    caret(bob.editor, 0);
    expect(bob.editor.exec({ type: 'insertText', text: 'חדש ' }).ok).toBe(true);
    peers.resume();
    converge();
    expect(alice.editor.surface!.session.bodyText()).toBe('חדש ' + before + after);
    expect(bob.editor.surface!.session.bodyText()).toBe('חדש ' + before + after);
  });
}
