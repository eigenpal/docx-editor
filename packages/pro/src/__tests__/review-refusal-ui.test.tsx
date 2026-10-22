/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The packaged review cards say why an action did not land.
//
// A refused accept used to leave the card exactly as it was, with no message, so the button
// looked broken. The card now names the cause the editor reported, and the notice goes away
// once the state that caused it changes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { DocxEditorReview, useReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';
import {
  stubCollaborationModule,
  stubCollaborationSession,
} from '../../../core/src/editor/__tests__/collaboration-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const TRACKED = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
      `<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">` +
      `<w:r><w:t>added text</w:t></w:r></w:ins></w:p></w:body></w:document>`
  ),
});

afterEach(() => cleanup());

const notReady = () =>
  stubCollaborationSession({ gateOperations: () => 'collaboration-session-not-ready' });
const WAITING = 'Waiting for the shared session. Try again in a moment.';

/** A custom component with its OWN `useReview()`, beside the packaged rail. */
function CustomProbe() {
  const { lastRefusal } = useReview();
  return <output data-testid="custom-probe">{lastRefusal?.code ?? ''}</output>;
}

function mount() {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={TRACKED}
      author="Grace Hopper"
      modules={[reviewModule(), stubCollaborationModule(notReady())]}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
      <CustomProbe />
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

test('a refused accept names its cause on the card until the state changes', async () => {
  const { view, editor } = mount();
  expect(view.queryByTestId('review-refusal')).toBeNull();

  await act(async () => {
    fireEvent.click(view.getByTestId('review-accept'));
  });
  const notice = view.getByTestId('review-refusal');
  expect(notice.textContent).toBe(WAITING);
  expect(notice.dataset.refusalCode).toBe('edit.collaboration-not-ready');
  // Plain text in the card; the rail's live region is what announces it.
  expect(notice.getAttribute('role')).toBeNull();
  expect(view.getByTestId('review-refusal-live').textContent).toBe(WAITING);
  // Another component's own hook sees the same refusal.
  expect(view.getByTestId('custom-probe').textContent).toBe('edit.collaboration-not-ready');
  // The change is still there to accept once the session is ready.
  expect(view.getAllByTestId('review-card')).toHaveLength(1);

  // A caret move is not a change of cause.
  await act(async () => {
    editor().surface!.selectAll();
  });
  expect(view.getByTestId('review-refusal').textContent).toBe(WAITING);

  await act(async () => {
    editor().exec({ type: 'setEditingMode', mode: 'viewing' });
  });
  expect(view.queryByTestId('review-refusal')).toBeNull();
  expect(view.getByTestId('review-refusal-live').textContent).toBe('');
  expect(view.getByTestId('custom-probe').textContent).toBe('');
});

test('a refused reply names its cause in the reply line', async () => {
  const { view, editor } = mount();
  const revision = editor()
    .getReviewItems({ pairReplacements: false })
    .find((item) => item.kind === 'revision')!;
  await act(async () => {
    editor().setActiveReviewItem(revision.key);
  });
  const input = view.getByTestId('review-reply-input') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: 'Looks right' } });
  });
  await act(async () => {
    fireEvent.click(view.getByTestId('review-reply-submit'));
  });
  expect(view.getByTestId('review-reply-refused').textContent).toBe(WAITING);
  // The reply line owns this one; the card does not repeat it.
  expect(view.queryByTestId('review-refusal')).toBeNull();
  // Recorded in the editor's store like any other refused write, and announced by the rail.
  expect(view.getByTestId('custom-probe').textContent).toBe('edit.collaboration-not-ready');
  expect(view.getByTestId('review-refusal-live').textContent).toBe(WAITING);
});

const LOCKED = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>` +
      `<w:sdtContent><w:p><w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">` +
      `<w:r><w:t>added text</w:t></w:r></w:ins></w:p></w:sdtContent></w:sdt></w:body></w:document>`
  ),
});

/** Discards the first revision through the hook and shows the refusal code. */
function DiscardProbe() {
  const { items, remove, lastRefusal } = useReview();
  const revision = items.find((item) => item.kind === 'revision');
  return (
    <>
      <button data-testid="discard" onClick={() => revision && remove(revision)} />
      <output data-testid="discard-code">{lastRefusal?.code ?? ''}</output>
    </>
  );
}

test('discarding a locked tracked change names the lock, as rejecting it does', async () => {
  const view = render(
    <DocxEditorRoot document={LOCKED} author="Grace Hopper" modules={[reviewModule()]}>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      <DiscardProbe />
    </DocxEditorRoot>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    fireEvent.click(view.getByTestId('discard'));
  });
  expect(view.getByTestId('discard-code').textContent).toBe('review.locked-content');
});
