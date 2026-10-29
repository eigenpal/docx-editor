/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { caretAt } from '@docx-editor.dev/core/layout';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  bodyStoryRoot,
  paragraphTextOf,
  storyParagraphs,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, R, REL, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('note-reference-typing', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

function fixture(shared = false, textRPr = '') {
  const reference = (kind: string) =>
    `<w:p><w:r>${textRPr}<w:t>Text</w:t></w:r><w:r>` +
    `<w:rPr><w:rStyle w:val="${kind}Reference"/><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:${kind}Reference w:id="1"/>${shared ? '<w:t>tail</w:t>' : ''}</w:r></w:p>`;
  const notes = (kind: string) =>
    `<w:${kind}s xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:${kind} w:id="1">` +
    `<w:p w14:paraId="${kind === 'footnote' ? '00000011' : '00000022'}"><w:r><w:${kind}Ref/></w:r><w:r><w:t>Note body</w:t></w:r></w:p>` +
    `</w:${kind}></w:${kind}s>`;
  return zipDocument(reference('footnote') + reference('endnote') + '<w:sectPr/>', {
    overrides: ['footnote', 'endnote']
      .map(
        (kind) =>
          `<Override PartName="/word/${kind}s.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}s+xml"/>`
      )
      .join(''),
    documentRels:
      `<Relationships xmlns="${REL}">` +
      ['footnote', 'endnote']
        .map(
          (kind, i) => `<Relationship Id="rId${i + 1}" Type="${R}/${kind}s" Target="${kind}s.xml"/>`
        )
        .join('') +
      '</Relationships>',
    extraXml: { 'word/footnotes.xml': notes('footnote'), 'word/endnotes.xml': notes('endnote') },
  });
}

function mount(peer: Peer, author: string, tracked: boolean) {
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    author,
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  expect(editor.surface).toBeDefined();
  if (tracked) expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  return editor;
}

function select(editor: DocxEditorInstance, index: number, start: number, end = start) {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function paragraph(editor: DocxEditorInstance, index: number) {
  const pkg = editor.surface!.session.currentPackage();
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  return { part, node: storyParagraphs(bodyStoryRoot(part)!)[index]! };
}

function text(editor: DocxEditorInstance, index: number) {
  const { part, node } = paragraph(editor, index);
  const value = paragraphTextOf(part, node.id);
  if (value === null) throw Error('The body paragraph is missing');
  return value;
}

function ordinaryTypedRuns(editor: DocxEditorInstance) {
  for (const index of [0, 1]) {
    const check = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (
        node.kind === 'run' &&
        node.children.some(
          (child) =>
            child.kind === 'text' &&
            child.children.some((value) => value.kind === 'textValue' && /[ABCZ]/.test(value.value))
        )
      ) {
        expect(node.children.some((child) => child.kind === 'noteReference')).toBe(false);
        const properties = node.children.find((child) => child.kind === 'runProperties');
        if (properties?.kind === 'runProperties') {
          expect(
            properties.children.some(
              (child) => child.localName === 'rStyle' || child.localName === 'vertAlign'
            )
          ).toBe(false);
        }
      }
      for (const child of node.children) check(child);
    };
    check(paragraph(editor, index).node);
  }
}

for (const shared of [false, true]) {
  for (const tracked of [false, true]) {
    test(`${tracked ? 'tracked' : 'plain'} typing after ${shared ? 'shared-run' : 'terminal'} references converges on two mounted editors`, async () => {
      const peers = await harness.pair(fixture(shared));
      const alice = mount(peers.alice, 'Alice', tracked);
      const bob = mount(peers.bob, 'Bob', tracked);
      const sync = () => {
        peers.alice.room.session.flushPendingJournals();
        peers.bob.room.session.flushPendingJournals();
        const a = alice.surface!.session.currentPackage(),
          b = bob.surface!.session.currentPackage();
        expect(packageFingerprint(a)).toBe(packageFingerprint(b));
        expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
        ordinaryTypedRuns(alice);
        ordinaryTypedRuns(bob);
      };
      for (const editor of [alice, bob]) {
        for (const index of [0, 1]) {
          select(editor, index, 5);
          expect(editor.surface!.formatting().superscript).toBe(false);
        }
      }
      peers.pause();
      select(alice, 0, 5);
      expect(alice.exec({ type: 'insertText', text: 'A' }).ok).toBe(true);
      select(bob, 0, 5);
      expect(bob.exec({ type: 'insertText', text: 'B' }).ok).toBe(true);
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      peers.resume();
      sync();
      expect(text(alice, 0)).toMatch(
        shared ? /^Text\uFFFC(?:AB|BA)tail$/ : /^Text\uFFFC(?:AB|BA)$/
      );
      select(bob, 1, 4, 5);
      const localSelection = bob.surface!.state().selection;
      const beforePresence = packageFingerprint(bob.surface!.session.currentPackage());
      select(alice, 0, 5, 6);
      applyAwarenessUpdate(
        peers.bob.awareness,
        encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
        'reference-caret'
      );
      const remote = peers.bob.room.session.remoteSelections()[0];
      expect(remote).toBeDefined();
      if (!remote) throw Error('The reference-adjacent remote selection is missing');
      expect(remote.anchor.offset).toBe(5);
      expect(remote.head.offset).toBe(6);
      expect(bob.surface!.state().selection).toEqual(localSelection);
      expect(
        caretAt(bob.surface!.layout(), { paragraphId: remote.head.nodeId, offset: 6 })
      ).toEqual(caretAt(alice.surface!.layout(), alice.surface!.state().selection.head));
      expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(beforePresence);
      expect(alice.exec({ type: 'undo' }).ok).toBe(true);
      sync();
      expect(text(bob, 0)).toBe('Text\uFFFCB' + (shared ? 'tail' : ''));
      expect(alice.exec({ type: 'redo' }).ok).toBe(true);
      sync();

      peers.pause();
      select(alice, 1, 5);
      expect(alice.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
      // This edit targets the reference boundary, before the concurrent insertions.
      select(bob, 0, 5);
      expect(bob.exec({ type: 'insertText', text: 'C' }).ok).toBe(true);
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      peers.resume();
      sync();
      expect(text(alice, 1)).toBe('Text\uFFFCZ' + (shared ? 'tail' : ''));

      if (!tracked) {
        peers.pause();
        select(alice, 0, 4, 5);
        expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
        select(bob, 0, 8);
        expect(bob.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
        peers.alice.room.session.flushPendingJournals();
        peers.bob.room.session.flushPendingJournals();
        peers.resume();
        sync();
        expect(text(bob, 0)).not.toContain('\uFFFC');
        for (const character of ['A', 'B', 'C', 'Z']) expect(text(bob, 0)).toContain(character);
      }
      const saved = await alice.save();
      const restored = createDocxEditor({
        container: document.createElement('div'),
        document: saved,
        modules: [reviewModule()],
      });
      editors.push(restored);
      expect(saveReopenDigest(restored.surface!.session.currentPackage())).toEqual(
        saveReopenDigest(alice.surface!.session.currentPackage())
      );
      ordinaryTypedRuns(restored);

      bob.destroy();
      const rejoined = await harness.remount(peers.bob);
      const back = mount(rejoined, 'Bob', tracked);
      expect(packageFingerprint(back.surface!.session.currentPackage())).toBe(
        packageFingerprint(alice.surface!.session.currentPackage())
      );
      ordinaryTypedRuns(back);
    });
  }
}

test('explicit caret formatting after a reference applies to new text only', async () => {
  const peers = await harness.pair(fixture());
  const alice = mount(peers.alice, 'Alice', false),
    bob = mount(peers.bob, 'Bob', false);
  select(alice, 0, 5);
  expect(alice.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  expect(alice.exec({ type: 'insertText', text: 'A' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.surface!.session.currentPackage())
  );
  expect(alice.surface!.formatting().bold).toBe(true);
  ordinaryTypedRuns(alice);
});

function typedFaces(editor: DocxEditorInstance, index: number): string[][] {
  const faces: string[][] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'run') {
      const typed = node.children.some(
        (child) =>
          child.kind === 'text' &&
          child.children.some((value) => value.kind === 'textValue' && /[AB]/.test(value.value))
      );
      const properties = node.children.find((child) => child.kind === 'runProperties');
      if (typed) {
        faces.push(
          properties?.kind === 'runProperties'
            ? properties.children.map((child) => child.localName)
            : []
        );
      }
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(paragraph(editor, index).node);
  return faces;
}

for (const tracked of [false, true]) {
  test(`${tracked ? 'tracked' : 'plain'} typing after a reference takes the text face on both editors`, async () => {
    const peers = await harness.pair(fixture(false, '<w:rPr><w:i/></w:rPr>'));
    const alice = mount(peers.alice, 'Alice', tracked);
    const bob = mount(peers.bob, 'Bob', tracked);
    const sync = () => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      const a = alice.surface!.session.currentPackage(),
        b = bob.surface!.session.currentPackage();
      expect(packageFingerprint(a)).toBe(packageFingerprint(b));
      expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
    };
    for (const editor of [alice, bob]) {
      select(editor, 0, 5);
      expect(editor.surface!.formatting().italic).toBe(true);
      expect(editor.surface!.formatting().superscript).toBe(false);
    }
    peers.pause();
    select(alice, 0, 5);
    expect(alice.exec({ type: 'insertText', text: 'A' }).ok).toBe(true);
    select(bob, 0, 5);
    expect(bob.exec({ type: 'insertText', text: 'B' }).ok).toBe(true);
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    peers.resume();
    sync();
    expect(text(alice, 0)).toMatch(/^Text\uFFFC(?:AB|BA)$/);
    for (const editor of [alice, bob]) {
      const faces = typedFaces(editor, 0);
      expect(faces.length).toBeGreaterThan(0);
      for (const face of faces) expect(face).toEqual(['i']);
    }
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    sync();
    expect(text(bob, 0)).toBe('Text\uFFFCB');
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    sync();
    const saved = await alice.save();
    const restored = createDocxEditor({
      container: document.createElement('div'),
      document: saved,
      modules: [reviewModule()],
    });
    editors.push(restored);
    const reopened = typedFaces(restored, 0);
    expect(reopened.length).toBeGreaterThan(0);
    for (const face of reopened) expect(face).toEqual(['i']);
  });
}
