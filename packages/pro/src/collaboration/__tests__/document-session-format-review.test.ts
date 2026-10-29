/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A formatting change suggested during a session can be decided by either participant. The
// replicas name the nodes such a change creates by logical id, which carries no part name.
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('session-format-review', { offlineEditing: true });
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
      '<w:p><w:pPr><w:ind w:left="240"/></w:pPr><w:r><w:t>outside</w:t></w:r></w:p><w:sectPr/>'
  );

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
  if (tracked) expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  return editor;
}

function select(editor: DocxEditorInstance, index: number, start: number, end: number) {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

const xml = (editor: DocxEditorInstance) =>
  serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()));

async function settle(...open: DocxEditorInstance[]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      open.every(
        (editor) => editor.surface!.layout().revision === editor.surface!.session.packageRevision()
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const CHANGES = [
  { name: 'locked alignment', index: 0, command: { type: 'setAlignment', align: 'center' } },
  { name: 'alignment', index: 1, command: { type: 'setAlignment', align: 'center' } },
  { name: 'bold', index: 1, command: { type: 'toggleMark', mark: 'bold' } },
] as const;

for (const change of CHANGES) {
  for (const decider of ['author', 'peer'] as const) {
    for (const action of ['reject', 'accept'] as const) {
      test(`the ${decider} can ${action} suggested ${change.name} made in the session`, async () => {
        const pair = await harness.pair(fixture());
        const alice = mount(pair.alice, 'Alice', true);
        const bob = mount(pair.bob, 'Bob', false);
        const original = xml(bob);
        const flush = async () => {
          pair.alice.room.session.flushPendingJournals();
          pair.bob.room.session.flushPendingJournals();
          await settle(alice, bob);
        };
        select(alice, change.index, 1, 4);
        expect(alice.exec(change.command).ok).toBe(true);
        await flush();
        expect(xml(bob)).toMatch(/<w:(pPr|rPr)Change /);

        const deciding = decider === 'author' ? alice : bob;
        const result = deciding.exec({ type: 'resolveAllReviewChanges', action });
        expect(result).toMatchObject({ ok: true, changed: true });
        if (result.ok) expect(result.revisions?.skipped).toEqual([]);
        await flush();

        expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
          packageFingerprint(bob.surface!.session.currentPackage())
        );
        expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
          saveReopenDigest(bob.surface!.session.currentPackage())
        );
        const after = xml(bob);
        expect(after).not.toMatch(/<w:(pPr|rPr)Change /);
        expect(after.match(/<w:ind w:left="240"\/>/g)).toHaveLength(2);
        // A rejected run format can leave its run split; only the formatting must be gone.
        if (action === 'reject')
          expect(after.replace(/<\/w:t><\/w:r><w:r>(<w:rPr\/>)?<w:t>/g, '')).toBe(original);
        else expect(after).toMatch(change.name === 'bold' ? /<w:b\/>/ : /<w:jc w:val="center"\/>/);
      });
    }
  }
}
