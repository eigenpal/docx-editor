/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DocxEditorAuthorStyle,
  DocxEditorContent,
  DocxEditorRoot,
  DocxEditorViewport,
} from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

afterEach(() => {
  cleanup();
});

describe('the live review draft author', () => {
  test('updates the open draft author and color', () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={SOURCE}
        author="Demo Reviewer"
        modules={[reviewModule()]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorAuthorStyle author="Demo Reviewer" color="#b42318" />
        <DocxEditorAuthorStyle author="Updated Reviewer" color="#0b7285" />
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    act(() => instance!.surface!.selectAll());
    act(() => fireEvent.click(view.getByTestId('review-add-comment')));
    const draft = view.getByTestId('review-draft');
    expect(draft.dataset.reviewAuthor).toBe('Demo Reviewer');
    expect(draft.style.getPropertyValue('--doc-review-author-current')).toBe('#b42318');

    act(() => instance!.setAuthor('Updated Reviewer'));
    const updatedDraft = view.getByTestId('review-draft');
    expect(updatedDraft.dataset.reviewAuthor).toBe('Updated Reviewer');
    expect(updatedDraft.style.getPropertyValue('--doc-review-author-current')).toBe('#0b7285');
  });
});
