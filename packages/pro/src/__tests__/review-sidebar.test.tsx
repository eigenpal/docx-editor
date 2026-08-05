// The review sidebar, composed from `@docx-editor.dev/pro/react` inside the free
// adapter's Root/Viewport/Content — moved here from the react package with the
// review lift (the pane is pro chrome now). Same pins as before the move.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/react';
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

describe('the review sidebar', () => {
  test('opens when the add-comment affordance starts a draft', async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={SOURCE}
        modules={[reviewModule()]}
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
    const editor = instance!;
    await act(async () => {
      editor.surface!.selectAll();
      editor.exec({ type: 'toggleReviewPane' });
    });
    expect(editor.isReviewPaneOpen()).toBe(false);

    await act(async () => {
      view.getByTestId('review-add-comment').click();
    });

    expect(editor.isReviewPaneOpen()).toBe(true);
    expect(view.getByTestId('review-draft')).toBeDefined();
  });

  test('removes an open comment draft when the sidebar closes', async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={SOURCE}
        modules={[reviewModule()]}
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
    const editor = instance!;
    await act(async () => {
      editor.surface!.selectAll();
    });
    await act(async () => {
      view.getByTestId('review-add-comment').click();
    });
    expect(view.getByTestId('review-draft')).toBeDefined();

    await act(async () => {
      editor.exec({ type: 'toggleReviewPane' });
    });

    expect(view.queryByTestId('review-draft')).toBeNull();
  });
});
