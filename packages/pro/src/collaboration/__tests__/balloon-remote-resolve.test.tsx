/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A change balloon is open on one participant while another resolves the change. The
// balloon must not keep a decision that no longer exists, and a reply the reader was typing
// must not vanish without notice.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../../react/index.ts';
import { collaborationModule, reviewModule } from '../../index.ts';
import { typeInto } from '../../__tests__/review-balloons-harness.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';
import { packageFingerprint } from './document-support';

const harness = createPeerHarness('balloon-remote-resolve', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const DATE = 'w:date="2026-01-02T03:04:05Z"';
const SOURCE = zipDocument(
  `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
    `<w:ins w:id="1" w:author="Ada Lovelace" ${DATE}><w:r><w:t>added</w:t></w:r></w:ins></w:p>` +
    `<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>`
);

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** Alice: the packaged rail with change balloons. Bob: a bare engine on the same room. */
async function open(): Promise<{
  view: ReturnType<typeof render>;
  alice: () => DocxEditorInstance;
  bob: DocxEditorInstance;
  sync: () => void;
}> {
  const pair = await harness.pair(SOURCE);
  pair.alice.detach();
  pair.bob.detach();
  let alice: DocxEditorInstance | undefined;
  const view = render(
    <DocxEditorRoot
      document={pair.alice.room.document}
      author="Alice"
      modules={[
        reviewModule({ pane: { revisionsIn: 'balloons' } }),
        collaborationModule({ session: pair.alice.room.session }),
      ]}
      onReady={(editor) => {
        alice = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const bob = mountBob(pair.bob);
  await settle();
  const sync = (): void => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  return { view, alice: () => alice!, bob, sync };
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

const balloon = (root: ParentNode) =>
  root.querySelector<HTMLElement>('[data-testid="review-balloon"]');

async function openBalloon(root: HTMLElement): Promise<HTMLElement> {
  const site = root.querySelector('[data-revision-kind="insert"][data-revision-id="1"]')!;
  await act(async () => {
    site.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await settle();
  const open = balloon(root);
  expect(open).not.toBeNull();
  return open!;
}

const insertionKey = (editor: DocxEditorInstance) =>
  editor.getReviewItems({ placement: false }).find((item) => item.kind === 'revision')!.key;

test('a remote accept keeps a reply draft and says why it cannot be posted', async () => {
  const { view, alice, bob, sync } = await open();
  const open1 = await openBalloon(view.container);
  const input = open1.querySelector<HTMLInputElement>('[data-testid="review-reply-input"]')!;
  await act(async () => typeInto(input, 'Half a thought'));

  expect(bob.acceptReviewItem(insertionKey(bob)).ok).toBe(true);
  await act(async () => sync());
  await settle();

  expect(
    alice()
      .getReviewItems({ placement: false })
      .some((i) => i.kind === 'revision')
  ).toBe(false);
  const kept = balloon(view.container)!;
  expect(kept).not.toBeNull();
  expect(kept.querySelector<HTMLInputElement>('[data-testid="review-reply-input"]')!.value).toBe(
    'Half a thought'
  );
  expect(kept.querySelector('[data-testid="review-reply-orphaned"]')?.getAttribute('role')).toBe(
    'alert'
  );
  // No decision is offered for a change that no longer exists.
  expect(kept.querySelector('[data-testid="review-accept"]')).toBeNull();
  // Sending posts nothing and keeps the text.
  await act(async () => {
    kept
      .querySelector<HTMLInputElement>('[data-testid="review-reply-input"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(alice().getReviewItems({ placement: false })).toHaveLength(0);
  expect(packageFingerprint(alice().surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.surface!.session.currentPackage())
  );
});

test('a remote reject with no draft closes the balloon', async () => {
  const { view, alice, bob, sync } = await open();
  await openBalloon(view.container);

  expect(bob.rejectReviewItem(insertionKey(bob)).ok).toBe(true);
  await act(async () => sync());
  await settle();

  expect(balloon(view.container)).toBeNull();
  expect(packageFingerprint(alice().surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.surface!.session.currentPackage())
  );
});
