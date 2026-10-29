/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A data binding mirrors a control's text, so participants can change its paragraph formats,
// plainly or as suggestions, while the bound text stays protected. Concurrent changes merge,
// undo and redo replay, and every decision converges and survives a reopen.
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart, validateOoxmlPart } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('session-bound-paragraph-format', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const fixture = () =>
  zipDocument(
    '<w:sdt><w:sdtPr><w:tag w:val="bound"/>' +
      '<w:dataBinding w:storeItemID="{1}" w:xpath="/root/value"/><w:text/></w:sdtPr>' +
      '<w:sdtContent><w:p><w:pPr><w:ind w:left="240"/></w:pPr>' +
      '<w:r><w:t>BOUND</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
      '<w:p><w:r><w:t>outside</w:t></w:r></w:p><w:sectPr/>'
  );

function mount(peer: Peer, author: string) {
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
  return editor;
}

async function pairUp() {
  const pair = await harness.pair(fixture());
  const alice = mount(pair.alice, 'Alice');
  const bob = mount(pair.bob, 'Bob');
  const flush = async () => {
    for (let round = 0; round < 3; round += 1) {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  };
  for (const editor of [alice, bob]) {
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 4 },
    });
  }
  return { pair, alice, bob, flush };
}

/** The bound paragraph's `w:pPr`, without namespace declarations, dates, or ids. */
function boundProperties(editor: DocxEditorInstance): string {
  const xml = serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()))
    .replace(/ xmlns:\w+="[^"]*"/g, '')
    .replace(/ w:date="[^"]*"/g, '')
    .replace(/ w:id="[^"]*"/g, '');
  return /<w:sdtContent><w:p\b[^>]*>(<w:pPr>.*?<\/w:pPr>)(?=<w:r\b)/.exec(xml)?.[1] ?? '';
}

/** The bound text and binding are unchanged on both replicas. */
function expectBoundTextKept(...editors: DocxEditorInstance[]) {
  for (const editor of editors) {
    const xml = serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()));
    expect(xml).toContain('<w:t>BOUND</w:t>');
    expect(xml).toContain('w:dataBinding');
  }
}

function expectConverged(alice: DocxEditorInstance, bob: DocxEditorInstance) {
  const left = alice.surface!.session.currentPackage();
  const right = bob.surface!.session.currentPackage();
  expect(packageFingerprint(left)).toBe(packageFingerprint(right));
  expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
  expect(validateOoxmlPart(mainPart(right)).ok).toBe(true);
}

for (const action of ['accept', 'reject'] as const) {
  test(`a peer can ${action} a suggested indent in a data-bound control`, async () => {
    const { alice, bob, flush } = await pairUp();
    expect(alice.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    expect(alice.exec({ type: 'setIndent', left: 720 })).toMatchObject({ ok: true });
    await flush();
    expect(boundProperties(bob)).toBe(
      '<w:pPr><w:ind w:left="720"/>' +
        '<w:pPrChange w:author="Alice"><w:pPr><w:ind w:left="240"/></w:pPr></w:pPrChange></w:pPr>'
    );
    const result = bob.exec({ type: 'resolveAllReviewChanges', action });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (result.ok) expect(result.revisions?.skipped).toEqual([]);
    await flush();
    expectConverged(alice, bob);
    expect(boundProperties(alice)).toBe(
      action === 'accept'
        ? '<w:pPr><w:ind w:left="720"/></w:pPr>'
        : '<w:pPr><w:ind w:left="240"/></w:pPr>'
    );
    expectBoundTextKept(alice, bob);
  });
}

test('concurrent formats in one bound paragraph both apply, undo, and redo', async () => {
  const { pair, alice, bob, flush } = await pairUp();
  pair.pause();
  expect(alice.exec({ type: 'setIndent', left: 720 })).toMatchObject({ ok: true });
  expect(bob.exec({ type: 'toggleList', kind: 'bullet' })).toMatchObject({ ok: true });
  pair.resume();
  await flush();
  expectConverged(alice, bob);
  const merged = boundProperties(bob);
  expect(merged).toContain('<w:ind w:left="720"/>');
  expect(merged).toContain('<w:numPr>');
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  await flush();
  expectConverged(alice, bob);
  expect(boundProperties(bob)).toContain('<w:ind w:left="240"/>');
  expect(boundProperties(bob)).toContain('<w:numPr>');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  await flush();
  expectConverged(alice, bob);
  expect(boundProperties(bob)).toContain('<w:ind w:left="720"/>');
  expectBoundTextKept(alice, bob);
});

test('the bound text stays unchanged on both replicas', async () => {
  const { alice, bob, flush } = await pairUp();
  for (const editor of [alice, bob]) {
    expect(editor.exec({ type: 'insertText', text: 'X' })).not.toMatchObject({ changed: true });
  }
  await flush();
  expectConverged(alice, bob);
  expectBoundTextKept(alice, bob);
});
