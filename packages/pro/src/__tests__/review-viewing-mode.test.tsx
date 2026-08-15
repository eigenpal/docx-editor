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
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

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
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
);
const COMMENTED_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
      '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="7"/>` +
      '<w:r><w:t>hello</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
      '<w:r><w:commentReference w:id="7"/></w:r></w:p></w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      '<w:comment w:id="7" w:author="Ada" w14:paraId="A0000001"><w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment>' +
      '</w:comments>'
  ),
  'word/commentsExtended.xml': strToU8(
    `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="A0000001" w15:done="0"/></w15:commentsEx>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
      `<Relationship Id="rIdCE" Type="${COMMENTS_EXTENDED_REL}" Target="commentsExtended.xml"/>` +
      '</Relationships>'
  ),
});

function commentOf(editor: DocxEditorInstance) {
  const comment = editor.getReviewItems().find((item) => item.kind === 'comment');
  if (!comment || comment.kind !== 'comment') throw new Error('expected a comment');
  return comment;
}

afterEach(cleanup);

describe('review viewing mode', () => {
  test('disables add-comment, draft, and reply affordances and preserves drafts across toggles', async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={TRACKED}
        author="Grace Hopper"
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
    const draftInput = view.getByTestId('review-draft-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(draftInput, { target: { value: 'Hold this draft' } });
    });
    await act(async () => {
      fireEvent.click(view.getAllByTestId('review-card')[0]!);
    });
    const replyInput = view.getByTestId('review-reply-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(replyInput, { target: { value: 'Hold this reply' } });
      replyInput.focus();
    });

    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });

    expect(view.queryByTestId('review-add-comment')).toBeNull();
    expect((view.getByTestId('review-draft-input') as HTMLInputElement).readOnly).toBe(true);
    expect((view.getByTestId('review-draft-submit') as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByTestId('review-draft-submit') as HTMLButtonElement).title).toBe(
      'Read-only, no edits'
    );
    expect((view.getByTestId('review-reply-input') as HTMLInputElement).readOnly).toBe(true);
    expect((view.getByTestId('review-reply-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(draftInput.value).toBe('Hold this draft');
    expect(replyInput.value).toBe('Hold this reply');

    await act(async () => {
      fireEvent.click(view.getByTestId('review-draft-submit'));
      fireEvent.click(view.getByTestId('review-reply-submit'));
    });
    expect(view.queryByTestId('review-draft')).not.toBeNull();
    expect(editor.getReviewItems().length).toBe(1);

    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'editing' });
    });
    expect(draftInput.value).toBe('Hold this draft');
    expect(replyInput.value).toBe('Hold this reply');
    expect(draftInput.readOnly).toBe(false);
    expect(replyInput.readOnly).toBe(false);
    expect(view.queryByTestId('review-add-comment')).toBeNull();
    expect(document.activeElement).not.toBe(draftInput);
    expect(document.activeElement).toBe(replyInput);
  });

  test('focuses a new draft once on open and keeps focus after viewing returns to editing', async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={TRACKED}
        author="Grace Hopper"
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
    const draftInput = view.getByTestId('review-draft-input') as HTMLInputElement;
    expect(document.activeElement).toBe(draftInput);

    await act(async () => {
      fireEvent.click(view.getAllByTestId('review-card')[0]!);
    });
    const replyInput = view.getByTestId('review-reply-input') as HTMLInputElement;
    await act(async () => {
      replyInput.focus();
    });
    expect(document.activeElement).toBe(replyInput);

    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'editing' });
    });
    expect(document.activeElement).toBe(replyInput);
    expect(document.activeElement).not.toBe(draftInput);
  });

  test('localizes resolve and reopen titles on packaged cards', async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={COMMENTED_SOURCE}
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
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });

    const resolve = view.getByTestId('review-resolve') as HTMLButtonElement;
    expect(resolve.disabled).toBe(true);
    expect(resolve.title).toBe('Read-only, no edits');

    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'editing' });
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('review-resolve'));
    });
    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    const reopen = view.getByTestId('review-reopen') as HTMLButtonElement;
    expect(reopen.disabled).toBe(true);
    expect(reopen.title).toBe('Read-only, no edits');
    fireEvent.click(reopen);
    expect(commentOf(editor).resolved).toBe(true);
  });

  test('asChild resolve and reopen keep engine refusal over child props', async () => {
    let instance: DocxEditorInstance | null = null;
    let hostReopenClicks = 0;
    let hostReopenKeyActivations = 0;
    let hostReopenOtherKeys = 0;

    const view = render(
      <DocxEditorRoot
        document={COMMENTED_SOURCE}
        modules={[reviewModule()]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <DocxEditorReview.List>
              <DocxEditorReview.Card>
                <DocxEditorReview.Resolve asChild>
                  <button type="button" data-testid="host-resolve-button" disabled={false}>
                    Resolve
                  </button>
                </DocxEditorReview.Resolve>
                <DocxEditorReview.Reopen asChild>
                  <a
                    href="#reopen"
                    data-testid="host-reopen-link"
                    onClick={() => {
                      hostReopenClicks += 1;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') hostReopenKeyActivations += 1;
                      if (event.key === 'ArrowDown') hostReopenOtherKeys += 1;
                    }}
                  >
                    Reopen
                  </a>
                </DocxEditorReview.Reopen>
              </DocxEditorReview.Card>
            </DocxEditorReview.List>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const editor = instance!;

    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    const resolveButton = view.getByTestId('host-resolve-button') as HTMLButtonElement;
    expect(resolveButton.disabled).toBe(true);
    expect(resolveButton.title).toBe('Read-only, no edits');
    await act(async () => {
      fireEvent.click(resolveButton);
    });
    expect(commentOf(editor).resolved).toBe(false);

    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'editing' });
    });
    await act(async () => {
      fireEvent.click(resolveButton);
    });
    expect(commentOf(editor).resolved).toBe(true);

    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    const reopenLink = view.getByTestId('host-reopen-link') as HTMLAnchorElement;
    expect(reopenLink.getAttribute('aria-disabled')).toBe('true');
    expect(reopenLink.getAttribute('href')).toBeNull();
    expect(reopenLink.title).toBe('Read-only, no edits');
    await act(async () => {
      fireEvent.click(reopenLink);
      fireEvent.keyDown(reopenLink, { key: 'Enter' });
      fireEvent.keyDown(reopenLink, { key: ' ' });
      fireEvent.keyDown(reopenLink, { key: 'ArrowDown' });
    });
    expect(hostReopenClicks).toBe(0);
    expect(hostReopenKeyActivations).toBe(0);
    expect(hostReopenOtherKeys).toBe(1);
    expect(commentOf(editor).resolved).toBe(true);
  });

  test('asChild button composes consumer and engine handlers when enabled', async () => {
    let instance: DocxEditorInstance | null = null;
    let hostReopenClicks = 0;

    const view = render(
      <DocxEditorRoot
        document={COMMENTED_SOURCE}
        modules={[reviewModule()]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <DocxEditorReview.List>
              <DocxEditorReview.Card>
                <DocxEditorReview.Resolve asChild>
                  <button type="button" data-testid="host-resolve-button">
                    Resolve
                  </button>
                </DocxEditorReview.Resolve>
                <DocxEditorReview.Reopen asChild>
                  <button
                    type="button"
                    data-testid="host-reopen-button"
                    onClick={() => {
                      hostReopenClicks += 1;
                    }}
                  >
                    Reopen
                  </button>
                </DocxEditorReview.Reopen>
              </DocxEditorReview.Card>
            </DocxEditorReview.List>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const editor = instance!;

    await act(async () => {
      fireEvent.click(view.getByTestId('host-resolve-button'));
    });
    expect(commentOf(editor).resolved).toBe(true);

    await act(async () => {
      fireEvent.click(view.getByTestId('host-reopen-button'));
    });
    expect(hostReopenClicks).toBe(1);
    // Resolve asChild above already proves the engine handler runs on enabled native buttons.
  });

  test('asChild anchor composes consumer and engine handlers when enabled', async () => {
    let instance: DocxEditorInstance | null = null;
    const resolveClickOrder: string[] = [];
    const reopenClickOrder: string[] = [];
    const reopenKeyOrder: string[] = [];

    const view = render(
      <DocxEditorRoot
        document={COMMENTED_SOURCE}
        modules={[reviewModule()]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <DocxEditorReview.List>
              <DocxEditorReview.Card>
                <DocxEditorReview.Resolve asChild>
                  <a
                    href="#resolve-target"
                    data-testid="host-resolve-link"
                    onClick={() => {
                      resolveClickOrder.push('consumer-click');
                    }}
                  >
                    Resolve
                  </a>
                </DocxEditorReview.Resolve>
                <DocxEditorReview.Reopen asChild>
                  <a
                    href="#reopen-target"
                    data-testid="host-reopen-link-enabled"
                    onClick={() => {
                      reopenClickOrder.push('consumer-click');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        reopenKeyOrder.push(`consumer-keydown:${event.key}`);
                      }
                    }}
                  >
                    Reopen
                  </a>
                </DocxEditorReview.Reopen>
              </DocxEditorReview.Card>
            </DocxEditorReview.List>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const editor = instance!;
    const hashBefore = window.location.hash;

    await act(async () => {
      fireEvent.click(view.getByTestId('host-resolve-link'));
    });
    expect(resolveClickOrder).toEqual(['consumer-click']);
    expect(commentOf(editor).resolved).toBe(true);
    expect(window.location.hash).toBe(hashBefore);

    await act(async () => {
      fireEvent.click(view.getByTestId('host-reopen-link-enabled'));
    });
    expect(reopenClickOrder).toEqual(['consumer-click']);
    expect(commentOf(editor).resolved).toBe(false);
    expect(window.location.hash).toBe(hashBefore);

    await act(async () => {
      fireEvent.click(view.getByTestId('host-resolve-link'));
    });
    expect(resolveClickOrder).toEqual(['consumer-click', 'consumer-click']);
    expect(commentOf(editor).resolved).toBe(true);

    await act(async () => {
      fireEvent.keyDown(view.getByTestId('host-reopen-link-enabled'), { key: 'Enter' });
    });
    expect(reopenKeyOrder).toEqual(['consumer-keydown:Enter']);
    expect(commentOf(editor).resolved).toBe(false);
    expect(window.location.hash).toBe(hashBefore);

    await act(async () => {
      fireEvent.click(view.getByTestId('host-resolve-link'));
    });
    await act(async () => {
      fireEvent.keyDown(view.getByTestId('host-reopen-link-enabled'), { key: ' ' });
    });
    expect(reopenKeyOrder).toEqual(['consumer-keydown:Enter', 'consumer-keydown: ']);
    expect(commentOf(editor).resolved).toBe(false);
    expect(window.location.hash).toBe(hashBefore);
  });

  test('asChild anchor suppresses engine when consumer prevents default', async () => {
    let instance: DocxEditorInstance | null = null;
    const clickOrder: string[] = [];
    const keyOrder: string[] = [];

    const view = render(
      <DocxEditorRoot
        document={COMMENTED_SOURCE}
        modules={[reviewModule()]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <DocxEditorReview.List>
              <DocxEditorReview.Card>
                <DocxEditorReview.Resolve asChild>
                  <a
                    href="#blocked-resolve"
                    data-testid="host-resolve-cancel"
                    onClick={(event) => {
                      clickOrder.push('consumer-click');
                      event.preventDefault();
                    }}
                  >
                    Resolve
                  </a>
                </DocxEditorReview.Resolve>
                <DocxEditorReview.Reopen asChild>
                  <a
                    href="#blocked-reopen"
                    data-testid="host-reopen-cancel"
                    onClick={() => {
                      clickOrder.push('consumer-reopen-click');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        keyOrder.push('consumer-keydown');
                        event.preventDefault();
                      }
                    }}
                  >
                    Reopen
                  </a>
                </DocxEditorReview.Reopen>
              </DocxEditorReview.Card>
            </DocxEditorReview.List>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const editor = instance!;
    const hashBefore = window.location.hash;

    await act(async () => {
      fireEvent.click(view.getByTestId('host-resolve-cancel'));
    });
    expect(clickOrder).toEqual(['consumer-click']);
    expect(commentOf(editor).resolved).toBe(false);
    expect(window.location.hash).toBe(hashBefore);

    await act(async () => {
      fireEvent.click(view.getByTestId('host-resolve-cancel'));
      fireEvent.click(view.getByTestId('host-resolve-cancel'));
    });
    await act(async () => {
      editor.setCommentResolved(commentOf(editor).key, true);
    });
    expect(commentOf(editor).resolved).toBe(true);

    await act(async () => {
      fireEvent.keyDown(view.getByTestId('host-reopen-cancel'), { key: 'Enter' });
    });
    expect(keyOrder).toEqual(['consumer-keydown']);
    expect(commentOf(editor).resolved).toBe(true);
    expect(window.location.hash).toBe(hashBefore);
  });
});
