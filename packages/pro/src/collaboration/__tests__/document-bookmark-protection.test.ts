/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, R, REL, W, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

test('protected bookmark refusal preserves every story and collaboration history', async () => {
  const marker = (id: number, name: string) =>
    `<w:bookmarkStart w:id="${id}" w:name="${name}"/><w:r><w:t>Text</w:t></w:r><w:bookmarkEnd w:id="${id}"/>`;
  const source = zipDocument(
    `<w:p>${marker(1, 'Same')}</w:p><w:p><w:r><w:t>Target</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="h"/><w:footerReference w:type="default" r:id="f"/></w:sectPr>`,
    {
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
      documentRels: `<Relationships xmlns="${REL}"><Relationship Id="h" Type="${R}/header" Target="header1.xml"/><Relationship Id="f" Type="${R}/footer" Target="footer1.xml"/></Relationships>`,
      extraXml: {
        'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent><w:p>${marker(2, 'Same')}${marker(3, 'Locked')}</w:p></w:sdtContent></w:sdt></w:hdr>`,
        'word/footer1.xml': `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>`,
      },
    }
  );
  const harness = createPeerHarness('bookmark-protection-room', { offlineEditing: true });
  const peers = await harness.pair(source);
  const editors = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  });
  const [alice, bob] = editors;
  const runtime = DocxEditor.createBrowser(alice!);
  const remote = DocxEditor.createBrowser(bob!);
  const fingerprint = () => packageFingerprint(alice!.surface!.session.currentPackage());
  const converged = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(bob!.surface!.session.currentPackage())).toBe(fingerprint());
    expect(saveReopenDigest(bob!.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(alice!.surface!.session.currentPackage())
    );
  };
  try {
    const initial = fingerprint();
    await runtime.run(async (context) => {
      context.document.body.search('Target').getFirst().insertBookmark('Prior');
      await context.sync();
    });
    converged();
    const before = fingerprint();
    for (const action of ['delete', 'move'] as const) {
      await expect(
        runtime.run(async (context) => {
          if (action === 'delete') context.document.deleteBookmark('Locked');
          else
            context.document.sections
              .getFirst()
              .getFooter('Primary')
              .getRange('Whole')
              .insertBookmark('Same');
          await context.sync();
        })
      ).rejects.toThrow();
      expect(fingerprint()).toBe(before);
      converged();
    }
    expect(alice!.exec({ type: 'deleteBookmark', name: 'Same' }).ok).toBe(false);
    expect(alice!.exec({ type: 'keepFirstBookmark', name: 'Same' }).ok).toBe(false);
    expect(fingerprint()).toBe(before);
    expect(alice!.exec({ type: 'undo' }).ok).toBe(true);
    converged();
    expect(fingerprint()).toBe(initial);
    expect(alice!.exec({ type: 'redo' }).ok).toBe(true);
    converged();
    expect(fingerprint()).toBe(before);
    peers.pause();
    await remote.run(async (context) => {
      context.document.body.search('Target').getFirst().insertText('Changed', 'Replace');
      await context.sync();
    });
    await expect(
      runtime.run(async (context) => {
        context.document.deleteBookmark('Locked');
        await context.sync();
      })
    ).rejects.toThrow();
    peers.resume();
    converged();
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: await alice!.save(),
    });
    try {
      expect(reopened.query({ type: 'bookmarks' })).toMatchObject([
        { name: 'Same', duplicates: 1 },
        { name: 'Locked', duplicates: 0 },
      ]);
    } finally {
      reopened.destroy();
    }
  } finally {
    runtime.dispose();
    remote.dispose();
    for (const editor of editors) editor.destroy();
    harness.cleanup();
  }
});
