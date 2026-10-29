/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The link popover is open on one participant while another edits the document. A create
// panel describes "these words are about to become a link": when a peer deletes those words,
// the panel closes instead of inserting the draft as a new link at the collapsed caret. An
// edit elsewhere leaves the panel open, and Apply still links the selected words.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DocxEditorContent,
  DocxEditorContextMenu,
  DocxEditorHyperLink,
  DocxEditorRoot,
  DocxEditorViewport,
} from '@docx-editor.dev/react';
import { collaborationModule } from '../../index.ts';
import { reviewModule } from '../../review/review-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';
import { packageFingerprint, saveReopenDigest } from './document-support';

const harness = createPeerHarness('link-popover-remote-target', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const SOURCE = zipDocument(
  '<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second line</w:t></w:r></w:p><w:sectPr/>'
);

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
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

async function open(source: Uint8Array = SOURCE) {
  const pair = await harness.pair(source);
  pair.alice.detach();
  pair.bob.detach();
  let alice: DocxEditorInstance | undefined;
  const view = render(
    <DocxEditorRoot
      document={pair.alice.room.document}
      modules={[reviewModule(), collaborationModule({ session: pair.alice.room.session })]}
      onReady={(editor) => {
        alice = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorHyperLink />
        <DocxEditorContextMenu />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const bob = mountBob(pair.bob);
  await settle();
  const sync = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  return { view, alice: () => alice!, bob, sync };
}

function converged(a: DocxEditorInstance, b: DocxEditorInstance): void {
  const left = a.surface!.session.currentPackage();
  const right = b.surface!.session.currentPackage();
  expect(packageFingerprint(right)).toBe(packageFingerprint(left));
  expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
}

/** Select "example" on Alice and open the create panel from the context menu row. */
function openPanelOnWord(view: ReturnType<typeof render>, alice: DocxEditorInstance) {
  const pid = alice.surface!.session.paragraphIds()[0]!;
  act(() => {
    alice.surface!.setSelection({
      anchor: { paragraphId: pid, offset: 6 },
      head: { paragraphId: pid, offset: 13 },
    });
  });
  act(() => {
    const surface = view.container.querySelector('.docx-paginated-surface')!;
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
  act(() => {
    fireEvent.click(view.container.querySelector('[role="menu"] [data-slot="text.link"]')!);
  });
  const input = view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
  act(() => {
    fireEvent.change(input, { target: { value: 'https://example.com/b' } });
  });
  return input;
}

/** Every link in a paragraph, as `text|href`. */
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

test('a peer deleting the selected words closes the create panel and links nothing', async () => {
  const { view, alice, bob, sync } = await open();
  openPanelOnWord(view, alice());
  expect(view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');

  const pid = bob.surface!.session.paragraphIds()[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: pid, offset: 5 },
    head: { paragraphId: pid, offset: 13 },
  });
  bob.surface!.deleteBackward();
  sync();
  await settle();

  expect(view.queryByTestId('hyperlink-popup')).toBeNull();
  sync();
  expect(linksIn(alice(), 0)).toEqual([]);
  expect(linksIn(bob, 0)).toEqual([]);
  converged(alice(), bob);

  // The peer's undo brings the words back on both sides; no link appears with them.
  bob.exec({ type: 'undo' });
  sync();
  await settle();
  expect(linksIn(alice(), 0)).toEqual([]);
  converged(alice(), bob);
});

test('a peer editing elsewhere leaves the panel open, and Apply links the selected words', async () => {
  const { view, alice, bob, sync } = await open();
  const input = openPanelOnWord(view, alice());

  const second = bob.surface!.session.paragraphIds()[1]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: second, offset: 0 },
    head: { paragraphId: second, offset: 0 },
  });
  bob.surface!.type('New ');
  sync();
  await settle();

  expect(view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');
  act(() => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  await settle();
  sync();
  expect(view.queryByTestId('hyperlink-popup')).toBeNull();
  expect(linksIn(alice(), 0)).toEqual(['example|https://example.com/b']);
  expect(linksIn(bob, 0)).toEqual(['example|https://example.com/b']);
  converged(alice(), bob);

  alice().exec({ type: 'undo' });
  sync();
  expect(linksIn(bob, 0)).toEqual([]);
  converged(alice(), bob);
  alice().exec({ type: 'redo' });
  sync();
  expect(linksIn(bob, 0)).toEqual(['example|https://example.com/b']);
  converged(alice(), bob);
});

// Longer than the per-update check reads, so only Apply compares the selected text.
const LONG = 'a'.repeat(5000);
const LONG_SOURCE = zipDocument(
  `<w:p><w:r><w:t>${LONG}</w:t></w:r></w:p>` +
    '<w:p><w:r><w:t>Second line</w:t></w:r></w:p><w:sectPr/>'
);

test('a long target is not reread on every update, and Apply still refuses a deleted one', async () => {
  const { view, alice, bob, sync } = await open(LONG_SOURCE);
  const pid = alice().surface!.session.paragraphIds()[0]!;
  act(() => {
    alice().surface!.setSelection({
      anchor: { paragraphId: pid, offset: 0 },
      head: { paragraphId: pid, offset: LONG.length },
    });
  });
  act(() => {
    const surface = view.container.querySelector('.docx-paginated-surface')!;
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
  act(() => {
    fireEvent.click(view.container.querySelector('[role="menu"] [data-slot="text.link"]')!);
  });
  const input = view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
  act(() => {
    fireEvent.change(input, { target: { value: 'https://example.com/long' } });
  });

  // Count the selected-text reads a remote update triggers.
  const editor = alice();
  const query = editor.query.bind(editor);
  let reads = 0;
  editor.query = ((request: { type: string }) => {
    if (request.type === 'selectedText') reads += 1;
    return query(request as never);
  }) as typeof editor.query;

  const second = bob.surface!.session.paragraphIds()[1]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: second, offset: 0 },
    head: { paragraphId: second, offset: 0 },
  });
  bob.surface!.type('New ');
  sync();
  await settle();
  expect(reads).toBe(0);
  expect(view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');

  // The peer deletes the long words. The panel is still open, and Apply refuses.
  const bobPid = bob.surface!.session.paragraphIds()[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: bobPid, offset: 0 },
    head: { paragraphId: bobPid, offset: LONG.length },
  });
  bob.surface!.deleteBackward();
  sync();
  await settle();
  act(() => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  await settle();
  sync();
  expect(reads).toBeGreaterThan(0);
  expect(view.queryByTestId('hyperlink-popup')).toBeNull();
  expect(linksIn(alice(), 0)).toEqual([]);
  expect(linksIn(bob, 0)).toEqual([]);
  converged(alice(), bob);
});

test('a peer striking the selected words in suggesting mode closes the panel and links nothing', async () => {
  const { view, alice, bob, sync } = await open();
  openPanelOnWord(view, alice());
  expect(view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');

  // The struck words stay in the document as a pending deletion, so the selected text is
  // unchanged; only the deletion tells the panel that its words are leaving.
  expect(bob.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  const pid = bob.surface!.session.paragraphIds()[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: pid, offset: 6 },
    head: { paragraphId: pid, offset: 13 },
  });
  bob.surface!.deleteBackward();
  sync();
  await settle();
  expect(alice().query({ type: 'selectedText' })).toBe('example');

  expect(view.queryByTestId('hyperlink-popup')).toBeNull();
  sync();
  expect(linksIn(alice(), 0)).toEqual([]);
  expect(linksIn(bob, 0)).toEqual([]);
  converged(alice(), bob);

  // The peer's undo withdraws the deletion on both sides; no link appears with the words.
  bob.exec({ type: 'undo' });
  sync();
  await settle();
  expect(linksIn(alice(), 0)).toEqual([]);
  converged(alice(), bob);
});

// The second word is already a pending deletion when the file opens.
const STRUCK_SOURCE = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Visit </w:t></w:r>' +
    '<w:del w:id="3" w:author="Ada" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>example</w:delText></w:r></w:del>' +
    '<w:r><w:t xml:space="preserve"> today</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second line</w:t></w:r></w:p><w:sectPr/>'
);

test('a panel opened on words already struck stays open, and Apply links them', async () => {
  const { view, alice, bob, sync } = await open(STRUCK_SOURCE);
  const input = openPanelOnWord(view, alice());
  expect(alice().surface!.hyperlinks.selectionIsPendingDeletion()).toBe(true);

  const second = bob.surface!.session.paragraphIds()[1]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: second, offset: 0 },
    head: { paragraphId: second, offset: 0 },
  });
  bob.surface!.type('New ');
  sync();
  await settle();
  expect(view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');

  act(() => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  await settle();
  sync();
  expect(view.queryByTestId('hyperlink-popup')).toBeNull();
  // The link wraps the struck words, so it shows no live text of its own.
  expect(linksIn(bob, 0)).toEqual(['|https://example.com/b']);
  converged(alice(), bob);
});
