/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of `link-popover-remote-target.test.tsx`: a peer that deletes the words an
// open create panel is about to link closes that panel, and nothing is linked.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { createApp, h, nextTick, type App } from 'vue';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DocxEditorContent,
  DocxEditorContextMenu,
  DocxEditorHyperLink,
  DocxEditorRoot,
  DocxEditorViewport,
} from '@docx-editor.dev/vue';
import { collaborationModule } from '../../index.ts';
import { reviewModule } from '../../review/review-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';
import { packageFingerprint, saveReopenDigest } from './document-support';

const harness = createPeerHarness('link-popover-remote-target-vue', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
  document.body.innerHTML = '';
});

const SOURCE = zipDocument(
  '<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second line</w:t></w:r></w:p><w:sectPr/>'
);

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await nextTick();
}

function mountBob(peer: Peer): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    author: 'Bob',
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return editor;
}

async function open() {
  const pair = await harness.pair(SOURCE);
  pair.alice.detach();
  pair.bob.detach();
  let alice: DocxEditorInstance | undefined;
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: pair.alice.room.document,
          modules: [reviewModule(), collaborationModule({ session: pair.alice.room.session })],
          onReady: (editor: unknown) => {
            alice = editor as DocxEditorInstance;
          },
        },
        {
          default: () => [
            h(DocxEditorViewport, null, {
              default: () => [
                h(DocxEditorContent),
                h(DocxEditorHyperLink),
                h(DocxEditorContextMenu),
              ],
            }),
          ],
        }
      ),
  });
  app.mount(container);
  apps.push(app);
  const bob = mountBob(pair.bob);
  await settle();
  await settle();
  const sync = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  return { container, alice: () => alice!, bob, sync };
}

function linksIn(editor: DocxEditorInstance, index: number): string[] {
  const surface = editor.surface!;
  const pid = surface.session.paragraphIds()[index]!;
  const before = surface.state().selection;
  surface.setSelection({
    anchor: { paragraphId: pid, offset: 0 },
    head: { paragraphId: pid, offset: 0 },
  });
  const out = surface.hyperlinks
    .linksInCaretParagraph()
    .map((link) => `${link.text}|${link.href ?? ''}`);
  surface.setSelection(before);
  return out;
}

/** Select "example" on Alice and open the create panel from the context menu row. */
async function openPanelOnWord(container: HTMLElement, alice: DocxEditorInstance) {
  const pid = alice.surface!.session.paragraphIds()[0]!;
  alice.surface!.setSelection({
    anchor: { paragraphId: pid, offset: 6 },
    head: { paragraphId: pid, offset: 13 },
  });
  await settle();
  container
    .querySelector('.docx-paginated-surface')!
    .dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 })
    );
  await settle();
  container.querySelector<HTMLElement>('[role="menu"] [data-slot="text.link"]')!.click();
  await settle();
  const popup = () => container.querySelector<HTMLElement>('[data-testid="hyperlink-popup"]');
  expect(popup()?.dataset.mode).toBe('editing');
  return popup;
}

test('a peer striking the selected words in suggesting mode closes the panel', async () => {
  const { container, alice, bob, sync } = await open();
  const popup = await openPanelOnWord(container, alice());

  expect(bob.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  const bobPid = bob.surface!.session.paragraphIds()[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: bobPid, offset: 6 },
    head: { paragraphId: bobPid, offset: 13 },
  });
  bob.surface!.deleteBackward();
  sync();
  await settle();

  expect(alice().query({ type: 'selectedText' })).toBe('example');
  expect(popup()).toBeNull();
  sync();
  expect(linksIn(alice(), 0)).toEqual([]);
  expect(linksIn(bob, 0)).toEqual([]);
  const left = alice().surface!.session.currentPackage();
  const right = bob.surface!.session.currentPackage();
  expect(packageFingerprint(right)).toBe(packageFingerprint(left));
});

test('a peer deleting the selected words closes the create panel and links nothing', async () => {
  const { container, alice, bob, sync } = await open();
  const popup = await openPanelOnWord(container, alice());

  const bobPid = bob.surface!.session.paragraphIds()[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: bobPid, offset: 5 },
    head: { paragraphId: bobPid, offset: 13 },
  });
  bob.surface!.deleteBackward();
  sync();
  await settle();

  expect(popup()).toBeNull();
  sync();
  expect(linksIn(alice(), 0)).toEqual([]);
  expect(linksIn(bob, 0)).toEqual([]);
  const left = alice().surface!.session.currentPackage();
  const right = bob.surface!.session.currentPackage();
  expect(packageFingerprint(right)).toBe(packageFingerprint(left));
  expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
});
