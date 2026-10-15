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
import { DocxEditorReview } from '../react/index.ts';
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

test('a refused accept names its cause on the card until the state changes', async () => {
  const session = stubCollaborationSession({
    gateOperations: () => 'collaboration-session-not-ready',
  });
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={TRACKED}
      author="Grace Hopper"
      modules={[reviewModule(), stubCollaborationModule(session)]}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  expect(view.queryByTestId('review-refusal')).toBeNull();

  await act(async () => {
    fireEvent.click(view.getByTestId('review-accept'));
  });
  const notice = view.getByTestId('review-refusal');
  expect(notice.textContent).toBe('Waiting for the shared session. Try again in a moment.');
  expect(notice.getAttribute('role')).toBe('alert');
  expect(notice.dataset.refusalCode).toBe('edit.collaboration-not-ready');
  // The change is still there to accept once the session is ready.
  expect(view.getAllByTestId('review-card')).toHaveLength(1);

  await act(async () => {
    instance!.exec({ type: 'setEditingMode', mode: 'viewing' });
  });
  expect(view.queryByTestId('review-refusal')).toBeNull();
});
