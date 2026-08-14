/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Review compound ownership: root affordances, list templates and card parts must compose
// without one scope consuming or nesting another.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Fragment } from 'react';
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { reviewModule } from '../index.ts';
import { DocxEditorReview } from '../react/index.ts';

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

const PLAIN = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');
const TRACKED = docx(
  '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
);

afterEach(cleanup);

describe('review compound composition', () => {
  test('combines an AddComment override with a List render callback', async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={TRACKED}
        modules={[reviewModule()]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <Fragment>
              <DocxEditorReview.List>
                {(item) => <div data-testid="custom-review-card">{item.text}</div>}
              </DocxEditorReview.List>
              <DocxEditorReview.AddComment>
                <button type="button" data-testid="custom-add-comment">
                  Add
                </button>
              </DocxEditorReview.AddComment>
            </Fragment>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    expect(view.getAllByTestId('custom-review-card')).toHaveLength(1);
    await act(async () => {
      instance!.surface!.selectAll();
    });
    expect(view.getByTestId('custom-add-comment')).toBeDefined();
  });

  test('renders a List Card template directly and applies both card classes', () => {
    const view = render(
      <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview card={{ className: 'root-card-class' }}>
            <DocxEditorReview.List>
              <Fragment>
                <DocxEditorReview.Card className="template-card-class">
                  <DocxEditorReview.Author />
                  <span data-testid="card-extra">Host action</span>
                </DocxEditorReview.Card>
              </Fragment>
            </DocxEditorReview.List>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    const cards = view.getAllByTestId('review-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.classList.contains('root-card-class')).toBe(true);
    expect(cards[0]!.classList.contains('template-card-class')).toBe(true);
    expect(cards[0]!.querySelector('[data-testid="review-card"]')).toBeNull();
    expect(view.getByTestId('card-extra').textContent).toBe('Host action');
  });

  test('keeps direct root Card children as a compatibility shorthand', () => {
    const view = render(
      <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <DocxEditorReview.Card>
              <span data-testid="root-card-extra">Root shorthand</span>
            </DocxEditorReview.Card>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    expect(view.getAllByTestId('review-card')).toHaveLength(1);
    expect(view.getByTestId('root-card-extra').textContent).toBe('Root shorthand');
  });

  test('wires explicitly supplied parts without adding preset defaults', async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={TRACKED}
        modules={[reviewModule()]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview preset={false}>
            <DocxEditorReview.AddComment>
              <button type="button" data-testid="explicit-add-comment">
                Add
              </button>
            </DocxEditorReview.AddComment>
            <DocxEditorReview.Draft />
            <DocxEditorReview.List>
              {(item) => <div data-testid="explicit-review-card">{item.text}</div>}
            </DocxEditorReview.List>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    expect(view.getAllByTestId('explicit-review-card')).toHaveLength(1);
    expect(view.queryByTestId('review-balloon')).toBeNull();
    await act(async () => {
      instance!.surface!.selectAll();
    });
    const add = view.getByTestId('explicit-add-comment');
    expect(add.style.position).toBe('absolute');
    expect(add.style.top).not.toBe('');
    await act(async () => {
      add.click();
    });
    expect(view.getByTestId('review-draft')).toBeDefined();
  });

  test('uses a List Empty override and preserves legacy root render children', () => {
    const empty = render(
      <DocxEditorRoot document={PLAIN} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <DocxEditorReview.List>
              <DocxEditorReview.Empty>All clear</DocxEditorReview.Empty>
            </DocxEditorReview.List>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(empty.getByTestId('review-empty').textContent).toBe('All clear');
    empty.unmount();

    const legacy = render(
      <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            {(item) => <div data-testid="legacy-review-card">{item.text}</div>}
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(legacy.getAllByTestId('legacy-review-card')).toHaveLength(1);
  });
});
