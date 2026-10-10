/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DocxEditorContent,
  DocxEditorMenu,
  DocxEditorRoot,
  DocxEditorToolbar,
  DocxEditorViewport,
} from '@docx-editor.dev/react';
import { reviewModule } from '../index.ts';
import { DocxEditorReview } from '../react/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function translateReviewMenu(key: string): string {
  if (key === 'toolbar.review') return 'Review';
  if (key === 'reviewers.markupOptions') return 'Markup Options';
  if (key === 'reviewers.label') return 'Reviewers';
  if (key === 'reviewers.all') return 'All';
  return key;
}

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

const TRACKED = docx(
  '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada"><w:r><w:t>ADA_INSERT</w:t></w:r></w:ins>' +
    '<w:ins w:id="2" w:author="Grace"><w:r><w:t>GRACE_INSERT</w:t></w:r></w:ins>' +
    '<w:del w:id="3" w:author="Ada"><w:r><w:delText>ADA_DELETE</w:delText></w:r></w:del>' +
    '<w:del w:id="4" w:author="Grace"><w:r><w:delText>GRACE_DELETE</w:delText></w:r></w:del>' +
    '</w:p>'
);

afterEach(cleanup);

describe('reviewer visibility chrome', () => {
  test('applies a host predicate over full revision data without changing OOXML', async () => {
    let editor: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={TRACKED}
        modules={[reviewModule()]}
        onReady={(instance) => {
          editor = instance as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const before = new Uint8Array(await editor!.save());
    const seen: Array<{ author: string; revisionKind: string; rangeCount: number }> = [];

    await act(async () => {
      editor!.setTrackedChangesFilter((revision) => {
        seen.push({
          author: revision.author,
          revisionKind: revision.revisionKind,
          rangeCount: revision.ranges.length,
        });
        return revision.author === 'Grace' && revision.revisionKind === 'insert';
      });
    });

    expect(seen).toHaveLength(4);
    expect(seen.every((revision) => revision.rangeCount === 1)).toBe(true);
    expect(editor!.getReviewItems({ placement: false })).toHaveLength(1);
    expect(editor!.getReviewItems({ placement: false })[0]).toMatchObject({
      author: 'Grace',
      revisionKind: 'insert',
    });
    await waitFor(() => {
      expect(view.container.querySelectorAll('.docx-revision-insert')).toHaveLength(1);
      expect(view.container.querySelectorAll('.docx-revision-delete')).toHaveLength(0);
    });
    expect(view.container.textContent).toContain('ADA_INSERT');
    expect(view.container.textContent).toContain('GRACE_INSERT');
    expect(view.container.textContent).not.toContain('ADA_DELETE');
    expect(view.container.textContent).not.toContain('GRACE_DELETE');
    expect(new Uint8Array(await editor!.save())).toEqual(before);

    await act(async () => {
      editor!.setTrackedChangesFilter(
        (revision) => revision.author === 'Grace' && revision.revisionKind === 'insert',
        'reject'
      );
    });
    await waitFor(() => {
      expect(view.container.querySelectorAll('.docx-revision-insert')).toHaveLength(1);
      expect(view.container.querySelectorAll('.docx-revision-delete')).toHaveLength(0);
    });
    expect(view.container.textContent).not.toContain('ADA_INSERT');
    expect(view.container.textContent).toContain('GRACE_INSERT');
    expect(view.container.textContent).toContain('ADA_DELETE');
    expect(view.container.textContent).toContain('GRACE_DELETE');
    expect(editor!.getReviewItems({ placement: false })).toHaveLength(1);
    expect(new Uint8Array(await editor!.save())).toEqual(before);

    await act(async () => {
      editor!.setTrackedChangesFilter(null);
    });
    await waitFor(() => {
      expect(view.container.querySelectorAll('.docx-revision-insert')).toHaveLength(2);
      expect(view.container.querySelectorAll('.docx-revision-delete')).toHaveLength(2);
    });
  });

  test('filters document markup and cards without changing saved OOXML', async () => {
    let editor: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={TRACKED}
        modules={[reviewModule()]}
        onReady={(instance) => {
          editor = instance as DocxEditorInstance;
        }}
      >
        <DocxEditorMenu t={translateReviewMenu} />
        <DocxEditorToolbar />
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    const before = new Uint8Array(await editor!.save());
    expect(editor!.getReviewAuthors().map((author) => author.author)).toEqual(['Ada', 'Grace']);
    expect(view.container.querySelectorAll('[data-review-author="Ada"]')).not.toHaveLength(0);

    await act(async () => {
      editor!.surface!.setRevisionAuthorVisible('Grace', false);
    });
    expect(editor!.isReviewAuthorVisible('Grace')).toBe(false);
    await act(async () => {
      editor!.surface!.showAllRevisionAuthors();
    });
    expect(editor!.isReviewAuthorVisible('Grace')).toBe(true);

    await act(async () => {
      fireEvent.click(view.getByRole('menuitem', { name: 'Review' }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole('menuitem', { name: 'Markup Options' }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole('menuitem', { name: 'Reviewers' }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole('menuitemcheckbox', { name: 'Ada' }));
    });

    expect(editor!.isReviewAuthorVisible('Ada')).toBe(false);
    expect(editor!.getReviewAuthors().map((author) => author.author)).toEqual(['Ada', 'Grace']);
    expect(editor!.getReviewItems().every((item) => item.author !== 'Ada')).toBe(true);
    await waitFor(() => {
      expect(
        view.container.querySelectorAll(
          '.docx-revision-insert[data-review-author="Ada"], .docx-revision-delete[data-review-author="Ada"]'
        )
      ).toHaveLength(0);
      expect(
        view.container.querySelectorAll('[data-testid="review-card"][data-review-author="Ada"]')
      ).toHaveLength(0);
    });
    expect(view.container.textContent).toContain('ADA_INSERT');
    expect(view.container.textContent).not.toContain('ADA_DELETE');
    expect(view.container.textContent).toContain('GRACE_DELETE');
    expect(new Uint8Array(await editor!.save())).toEqual(before);

    // A host bulk action iterates the public queue. Hidden authors must stay untouched.
    await act(async () => {
      for (const item of editor!.getReviewItems()) {
        if (item.kind === 'revision') expect(editor!.acceptReviewItem(item.key).ok).toBe(true);
      }
      fireEvent.click(view.getByRole('menuitemcheckbox', { name: 'All' }));
    });
    expect(editor!.isReviewAuthorVisible('Ada')).toBe(true);
    expect(editor!.getReviewItems().every((item) => item.author === 'Ada')).toBe(true);
    expect(view.container.textContent).toContain('ADA_DELETE');
    expect(view.container.textContent).not.toContain('GRACE_DELETE');

    await act(async () => {
      editor!.setReviewAuthorVisible('Ada', false);
      editor!.load(TRACKED);
    });
    await waitFor(() => expect(editor!.snapshot().hiddenReviewAuthors).toEqual([]));
  });
});
