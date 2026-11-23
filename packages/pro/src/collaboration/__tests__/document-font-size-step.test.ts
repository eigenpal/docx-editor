/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two collaborating editors grow and shrink a selection with mixed font sizes.
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('font-size-step', { offlineEditing: true });
const editors: DocxEditorInstance[] = [],
  containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const DOCUMENT =
  '<w:p><w:r><w:rPr><w:sz w:val="52"/></w:rPr><w:t>Big</w:t></w:r>' +
  '<w:r><w:t xml:space="preserve"> small text</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second line</w:t></w:r></w:p><w:sectPr/>';

function mount(peer: Peer, author: string, tracked = false) {
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
  if (tracked) expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  return editor;
}

function select(editor: DocxEditorInstance, start: number, end: number) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

/** The `w:sz` values of the first paragraph's runs, in order. */
function firstParagraphSizes(editor: DocxEditorInstance): string[] {
  const xml = serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()));
  const paragraph = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/)?.[0] ?? '';
  const runs =
    paragraph.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '').match(/<w:r>[\s\S]*?<\/w:r>/g) ?? [];
  return runs.map((run) => {
    const own = run.replace(/<w:rPrChange[\s\S]*?<\/w:rPrChange>/g, '');
    return own.match(/<w:sz w:val="(\d+)"\/>/)?.[1] ?? '-';
  });
}

for (const tracked of [false, true]) {
  test(`${tracked ? 'tracked' : 'plain'} mixed font size steps converge with concurrent edits`, async () => {
    const pair = await harness.pair(zipDocument(DOCUMENT));
    const alice = mount(pair.alice, 'Alice', tracked),
      bob = mount(pair.bob, 'Bob');
    const converge = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
      expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
        packageFingerprint(bob.surface!.session.currentPackage())
      );
      expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
        saveReopenDigest(bob.surface!.session.currentPackage())
      );
    };

    // Alice grows "Big small text" while Bob, offline, types into the small text.
    pair.pause();
    select(alice, 0, 14);
    expect(alice.exec({ type: 'increaseFontSize' })).toMatchObject({ ok: true, changed: true });
    select(bob, 8, 8);
    bob.surface!.type('X');
    pair.resume();
    converge();
    expect(bob.surface!.session.bodyText()).toContain('Big smalXl text');
    expect(firstParagraphSizes(bob)).toContain('56');
    // The package has no styles part, so the small text paints at the 12 pt application
    // default and grows to 14 pt.
    expect(firstParagraphSizes(bob)).toContain('28');
    expect(firstParagraphSizes(bob)).not.toContain('52');
    if (tracked) {
      expect(serializeOoxmlPart(mainPart(bob.surface!.session.currentPackage()))).toContain(
        'w:rPrChange'
      );
    }

    // Undo takes back only Alice's step; Bob's letter stays. Redo repeats it.
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converge();
    expect(firstParagraphSizes(bob)).toContain('52');
    expect(firstParagraphSizes(bob)).not.toContain('56');
    expect(bob.surface!.session.bodyText()).toContain('Big smalXl text');
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converge();
    expect(firstParagraphSizes(bob)).toContain('56');

    // Bob deletes "Big" while Alice shrinks the whole first line again.
    pair.pause();
    select(alice, 0, 15);
    expect(alice.exec({ type: 'decreaseFontSize' }).ok).toBe(true);
    select(bob, 0, 3);
    expect(bob.exec({ type: 'deleteText' }).ok).toBe(true);
    pair.resume();
    converge();
    expect(bob.surface!.session.bodyText()).toContain(' smalXl text');

    // Save and reopen keep the converged sizes.
    const before = firstParagraphSizes(alice);
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const reopened = createDocxEditor({ container, document: await alice.save() });
    editors.push(reopened);
    expect(firstParagraphSizes(reopened)).toEqual(before);
  });
}
