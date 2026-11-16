/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Closing a comment edit gives the keyboard back to the card's actions button, so a
// keyboard user who pressed Escape or Save is not left on the page body.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

const COMMENTED = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="1"/>` +
      '<w:r><w:t>text</w:t></w:r><w:commentRangeEnd w:id="1"/>' +
      '<w:r><w:commentReference w:id="1"/></w:r></w:p></w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Ada"><w:p><w:r><w:t>Note.</w:t></w:r></w:p></w:comment></w:comments>`
  ),
});

const frames = (count: number) =>
  act(async () => {
    for (let i = 0; i < count; i += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });

afterEach(() => {
  cleanup();
});

test('Escape in a comment edit returns focus to the actions button', async () => {
  const view = render(
    <DocxEditorRoot document={COMMENTED} author="Ada" modules={[reviewModule()]}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await frames(2);
  await act(async () => {
    fireEvent.click(view.getByTestId('review-card'));
  });
  await act(async () => {
    fireEvent.click(view.getByTestId('review-comment-actions'));
  });
  await act(async () => {
    fireEvent.click(view.getByTestId('review-edit'));
  });
  const input = view.getByTestId('review-edit-input');
  expect(document.activeElement).toBe(input);
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Escape' });
  });
  expect(view.queryByTestId('review-edit-input')).toBeNull();
  await frames(3);
  expect(document.activeElement).toBe(view.getByTestId('review-comment-actions'));
});
