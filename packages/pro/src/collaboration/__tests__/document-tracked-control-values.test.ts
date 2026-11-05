/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A content control value suggested over a collaboration session: the strike and insertion in
// the control and the control's recorded state replicate, converge with a peer's concurrent
// edits, undo and redo everywhere, and a decision on one peer restores the state on both.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('tracked-control-values', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Pick: </w:t></w:r><w:sdt><w:sdtPr>' +
  '<w:dropDownList w:lastValue="1"><w:listItem w:displayText="One" w:value="1"/>' +
  '<w:listItem w:displayText="Two" w:value="2"/><w:listItem w:displayText="Three" w:value="3"/>' +
  '</w:dropDownList></w:sdtPr><w:sdtContent><w:r><w:t>One</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
  `<w:p><w:r><w:t xml:space="preserve">Done: </w:t></w:r><w:sdt><w:sdtPr><w14:checkbox xmlns:w14="${W14}">` +
  '<w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>' +
  '<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>' +
  '<w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
  '<w:p><w:r><w:t>other</w:t></w:r></w:p>';

async function peers() {
  const pair = await harness.pair(zipDocument(BODY));
  const [alice, bob] = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  for (const [editor, author] of [
    [alice, 'Alice'],
    [bob, 'Bob'],
  ] as const) {
    editor.surface!.setAuthor(author);
    editor.surface!.setEditingMode('suggest');
  }
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    flush();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    // A refused journal realigns quietly, so agreement alone does not prove the edit landed.
    expect(pair.alice.room.session.statusSnapshot().failureCount).toBe(0);
    expect(pair.bob.room.session.statusSnapshot().failureCount).toBe(0);
  };
  return { pair, alice, bob, flush, converge };
}

/** The ids of the dropdown and the checkbox, in document order. */
function controls(editor: Editor): [string, string] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'contentControl') ids.push(node.id);
    for (const child of node.children) visit(child);
  };
  visit(editor.surface!.session.part().root);
  return ids as [string, string];
}

async function xml(editor: Editor): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

function caret(editor: Editor, paragraph: number, offset: number) {
  const point = { paragraphId: editor.surface!.session.paragraphIds()[paragraph]!, offset };
  editor.surface!.setSelection({ anchor: point, head: point });
}

test('a suggested value converges with peer typing, and a peer rejection restores the state', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  const [dropdown, checkbox] = controls(alice);
  expect(alice.surface!.contentControls.setValue(dropdown, '2')).toBe(true);
  expect(alice.surface!.contentControls.setValue(checkbox, 'true')).toBe(true);
  caret(bob, 2, 5);
  bob.surface!.type('!');
  flush();
  pair.resume();
  converge();
  for (const editor of [alice, bob]) {
    const saved = await xml(editor);
    expect(saved).toContain('<w:delText>One</w:delText>');
    expect(saved).toMatch(/<w:ins [^>]*w:author="Alice"[^>]*><w:r><w:t>Two<\/w:t>/);
    expect(saved).toContain('w:lastValue="2"');
    expect(saved).toContain('<w14:checked w14:val="1"/>');
    expect(saved).toMatch(/<w:ins [^>]*w:author="Bob"[^>]*><w:r><w:t>!<\/w:t>/);
  }
  expect(bob.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]).committed).toBe(true);
  converge();
  for (const editor of [alice, bob]) {
    const saved = await xml(editor);
    expect(saved).not.toContain('w:author="Alice"');
    expect(saved).not.toContain('w:author="Bob"');
    expect(saved).toContain('<w:t>One</w:t>');
    expect(saved).toContain('w:lastValue="1"');
    expect(saved).toContain('<w14:checked w14:val="0"/>');
  }
});

test('undo and redo of a suggested value replicate', async () => {
  const { alice, bob, converge } = await peers();
  const before = await xml(bob);
  const [dropdown] = controls(alice);
  expect(alice.surface!.contentControls.setValue(dropdown, '3')).toBe(true);
  converge();
  expect(await xml(bob)).toContain('w:lastValue="3"');
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(await xml(bob)).toBe(before);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(await xml(bob)).toContain('w:lastValue="3"');
  expect(alice.surface!.session.applyTreeOps([{ op: 'acceptAllRevisions' }]).committed).toBe(true);
  converge();
  const accepted = await xml(bob);
  expect(accepted).toContain('<w:t>Three</w:t>');
  expect(accepted).not.toContain('<w:del ');
});

test('two peers suggesting values for one dropdown at once converge', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  expect(alice.surface!.contentControls.setValue(controls(alice)[0], '2')).toBe(true);
  expect(bob.surface!.contentControls.setValue(controls(bob)[0], '3')).toBe(true);
  flush();
  pair.resume();
  converge();
  const saved = await xml(alice);
  expect(saved).toContain('w:author="Alice"');
  expect(saved).toContain('w:author="Bob"');
  expect(alice.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]).committed).toBe(true);
  converge();
  const rejected = await xml(bob);
  expect(rejected).not.toContain('<w:ins ');
  expect(rejected).toContain('w:lastValue="1"');
});

test('toggling a suggested checkbox back withdraws the proposal on both peers', async () => {
  const { alice, bob, converge } = await peers();
  const before = await xml(bob);
  const [, checkbox] = controls(alice);
  expect(alice.surface!.contentControls.setValue(checkbox, 'true')).toBe(true);
  converge();
  expect(await xml(bob)).toContain('<w14:checked w14:val="1"/>');
  expect(alice.surface!.contentControls.setValue(checkbox, 'false')).toBe(true);
  converge();
  expect(await xml(bob)).toBe(before);
});

test('suggested text at the end of a control lands inside it on both peers', async () => {
  const { alice, bob, converge } = await peers();
  const [dropdown] = controls(alice);
  const paragraphId = alice.surface!.session.paragraphIds()[0]!;
  const result = alice.surface!.session.applyTreeOps([
    {
      op: 'insertText',
      paragraphId,
      offset: 'Pick: One'.length,
      text: '!',
      inside: dropdown,
      revision: { author: 'Alice', date: '2026-11-04T00:00:00Z' },
    },
  ]);
  expect(result.committed).toBe(true);
  converge();
  const saved = await xml(bob);
  expect(saved).toMatch(/<w:t>One<\/w:t><\/w:r><w:ins [^>]*w:author="Alice"[^>]*><w:r>.*!<\/w:t>/);
  expect(saved.indexOf('!')).toBeLessThan(saved.indexOf('</w:sdtContent>'));
});

test('a peer deleting the paragraph while a value is suggested in it converges', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  bob.surface!.setEditingMode('edit');
  pair.pause();
  expect(alice.surface!.contentControls.setValue(controls(alice)[0], '2')).toBe(true);
  const ids = bob.surface!.session.paragraphIds();
  bob.surface!.setSelection({
    anchor: { paragraphId: ids[0]!, offset: 0 },
    head: { paragraphId: ids[1]!, offset: 0 },
  });
  bob.surface!.deleteBackward();
  flush();
  pair.resume();
  converge();
  expect(bob.surface!.session.bodyText()).toContain('other');
});
