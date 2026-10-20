/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { EditorFontError } from '@docx-editor.dev/core/contracts/editor';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

test('deferred font errors stay local while shared editors edit, save, and reopen', async () => {
  const harness = createPeerHarness('font-origin-load-epoch-editors');
  const views: { editor: DocxEditorInstance; container: HTMLElement; errors: EditorFontError[] }[] =
    [];
  let rejectPending!: (reason: Error) => void;
  let pendingStarted = false;
  let pendingSettled = false;
  const pending = new Promise<never>((_resolve, reject) => {
    rejectPending = reject;
  }).finally(() => {
    pendingSettled = true;
  });
  const catalog = ['Pending Public Sans'];
  const mount = (peer: Peer, defer: boolean) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      fonts: (request) => {
        if (defer && request.families.includes(catalog[0]!)) {
          pendingStarted = true;
          return pending;
        }
        return { supportedFamilies: catalog };
      },
      onFontError: (error) => errors.push(error),
    });
    const view = { editor, container, errors };
    views.push(view);
    return view;
  };
  const waitFor = async (check: () => boolean) => {
    for (let n = 0; n < 200; n++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw Error('Real shared editor font origin did not settle');
  };
  const xml = async (editor: DocxEditorInstance) =>
    strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  try {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>AB</w:t></w:r></w:p>')
    );
    const left = mount(alice, true),
      right = mount(bob, false);
    await waitFor(() => views.every((view) => !view.editor.fontMeasurement().resolving));
    const id = harness.paragraphIdAt(alice, 0);
    const select = (editor: DocxEditorInstance, offset: number, end = offset) =>
      editor.exec({
        type: 'setSelection',
        range: { anchor: { paragraphId: id, offset }, head: { paragraphId: id, offset: end } },
      });
    select(left.editor, 0);
    expect(
      left.editor.exec({
        type: 'setMarkAttr',
        mark: 'fontFamily',
        attr: 'family',
        value: catalog[0]!,
      }).ok
    ).toBe(true);
    await waitFor(() => pendingStarted);
    const sync = () => {
      alice.room.session.flushPendingJournals();
      bob.room.session.flushPendingJournals();
    };
    const expectShared = async (expected: string) => {
      sync();
      const leftPackage = left.editor.surface!.session.currentPackage();
      const rightPackage = right.editor.surface!.session.currentPackage();
      expect(packageFingerprint(rightPackage)).toBe(packageFingerprint(leftPackage));
      expect(saveReopenDigest(rightPackage)).toEqual(saveReopenDigest(leftPackage));
      for (const view of [left, right]) {
        expect(paragraphTextOf(view.editor.surface!.session.part(), id)).toBe(expected);
        expect(view.errors).toEqual([]);
      }
      expect(await xml(left.editor)).toBe(await xml(right.editor));
    };
    pause();
    select(left.editor, 0);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'insertText', text: 'L' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    sync();
    resume();
    await expectShared('LABR');
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    await expectShared('ABR');
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await expectShared('LABR');
    pause();
    select(left.editor, 1, 3);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    sync();
    resume();
    await expectShared('LXR');
    left.editor.destroy();
    rejectPending(Error('Public destroyed peer origin refused'));
    await waitFor(() => pendingSettled);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(left.errors).toEqual([]);
    expect(left.editor.surface).toBeNull();
    select(right.editor, 3);
    expect(right.editor.exec({ type: 'insertText', text: 'C' }).ok).toBe(true);
    bob.room.session.flushPendingJournals();
    expect(paragraphTextOf(right.editor.surface!.session.part(), id)).toBe('LXRC');
    expect(right.errors).toEqual([]);
    for (const peer of [alice, bob])
      expect(JSON.stringify(peer.awareness.getLocalState())).not.toContain(
        'Public destroyed peer origin refused'
      );
    const reopenContainer = document.createElement('div');
    const reopened = createDocxEditor({
      document: new Uint8Array(await right.editor.save()),
      container: reopenContainer,
    });
    views.push({ editor: reopened, container: reopenContainer, errors: [] });
    expect(reopened.surface!.session.bodyText()).toContain('LXRC');
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 10000);
