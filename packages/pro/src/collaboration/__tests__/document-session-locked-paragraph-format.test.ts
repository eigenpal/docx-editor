/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A content lock lets participants change a locked paragraph's alignment, indents, spacing,
// and keep settings, plainly or as suggestions, and keeps its style and list. Concurrent
// changes merge, undo and redo replay, and every decision converges and survives a reopen.
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart, validateOoxmlPart } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('session-locked-paragraph-format', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const fixture = () =>
  zipDocument(
    '<w:sdt><w:sdtPr><w:tag w:val="locked"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
      '<w:sdtContent><w:p><w:pPr><w:ind w:left="240"/></w:pPr>' +
      '<w:r><w:t>LOCKED</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
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

/** The locked paragraph's `w:pPr`, without namespace declarations or dates. */
function lockedProperties(editor: DocxEditorInstance): string {
  const xml = serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()))
    .replace(/ xmlns:\w+="[^"]*"/g, '')
    .replace(/ w:date="[^"]*"/g, '')
    .replace(/ w:id="[^"]*"/g, '');
  return /<w:sdtContent><w:p\b[^>]*>(<w:pPr>.*?<\/w:pPr>)(?=<w:r\b)/.exec(xml)?.[1] ?? '';
}

function expectConverged(alice: DocxEditorInstance, bob: DocxEditorInstance) {
  const left = alice.surface!.session.currentPackage();
  const right = bob.surface!.session.currentPackage();
  expect(packageFingerprint(left)).toBe(packageFingerprint(right));
  expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
  expect(validateOoxmlPart(mainPart(right)).ok).toBe(true);
}

for (const decider of ['author', 'peer'] as const) {
  for (const action of ['accept', 'reject'] as const) {
    test(`the ${decider} can ${action} suggested indent and spacing in a lock`, async () => {
      const { alice, bob, flush } = await pairUp();
      expect(alice.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
      expect(alice.exec({ type: 'setIndent', left: 720 })).toMatchObject({ ok: true });
      expect(alice.exec({ type: 'setParagraphSpacing', beforePt: 12 })).toMatchObject({ ok: true });
      await flush();
      expect(lockedProperties(bob)).toBe(
        '<w:pPr><w:spacing w:before="240" w:beforeAutospacing="0"/><w:ind w:left="720"/>' +
          '<w:pPrChange w:author="Alice"><w:pPr><w:ind w:left="240"/></w:pPr></w:pPrChange></w:pPr>'
      );

      const deciding = decider === 'author' ? alice : bob;
      const result = deciding.exec({ type: 'resolveAllReviewChanges', action });
      expect(result).toMatchObject({ ok: true, changed: true });
      if (result.ok) expect(result.revisions?.skipped).toEqual([]);
      await flush();
      expectConverged(alice, bob);
      expect(lockedProperties(alice)).toBe(
        action === 'accept'
          ? '<w:pPr><w:spacing w:before="240" w:beforeAutospacing="0"/><w:ind w:left="720"/></w:pPr>'
          : '<w:pPr><w:ind w:left="240"/></w:pPr>'
      );
    });
  }
}

test('concurrent indent and spacing in one locked paragraph both apply', async () => {
  const { pair, alice, bob, flush } = await pairUp();
  pair.pause();
  expect(alice.exec({ type: 'setIndent', left: 720 })).toMatchObject({ ok: true });
  expect(bob.exec({ type: 'setParagraphSpacing', afterPt: 6 })).toMatchObject({ ok: true });
  pair.resume();
  await flush();
  expectConverged(alice, bob);
  const merged = lockedProperties(bob);
  expect(merged).toContain('<w:ind w:left="720"/>');
  expect(merged).toContain('<w:spacing w:after="120" w:afterAutospacing="0"/>');
  // Each participant undoes only their own change.
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  await flush();
  expectConverged(alice, bob);
  expect(lockedProperties(bob)).toBe(
    '<w:pPr><w:spacing w:after="120" w:afterAutospacing="0"/><w:ind w:left="240"/></w:pPr>'
  );
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  await flush();
  expectConverged(alice, bob);
  expect(lockedProperties(bob)).toContain('<w:ind w:left="720"/>');
});

test('a list stays refused in the lock on both replicas', async () => {
  const { alice, bob, flush } = await pairUp();
  const before = lockedProperties(bob);
  expect(alice.exec({ type: 'toggleList', kind: 'bullet' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  expect(bob.can({ type: 'toggleList', kind: 'bullet' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  await flush();
  expect(lockedProperties(alice)).toBe(before);
  expectConverged(alice, bob);
});
