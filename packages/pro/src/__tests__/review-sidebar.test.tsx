/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review sidebar, composed from `@docx-editor.dev/pro/react` inside the free
// adapter's Root/Viewport/Content — moved here from the react package with the
// review lift (the pane is pro chrome now). Same pins as before the move.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DocxEditorContextMenu,
  DocxEditorRoot,
  DocxEditorViewport,
  DocxEditorContent,
} from '@docx-editor.dev/react';
import { DocxEditorReview, useReview } from '../react/index.ts';
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

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');
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

afterEach(() => {
  cleanup();
});

describe('the review sidebar', () => {
  test('right-click Add a comment starts a draft instead of only toggling the pane', async () => {
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
          <DocxEditorContextMenu t={(key) => key} />
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

    const surface = view.container.querySelector('.docx-paginated-surface');
    if (!surface) throw new Error('no painted surface');
    await act(async () => {
      fireEvent.contextMenu(surface, { clientX: 100, clientY: 100, button: 2 });
    });
    const row = view.container.querySelector(
      '[data-slot="review.comments"]'
    ) as HTMLButtonElement | null;
    expect(row).not.toBeNull();
    expect(row?.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => {
      row?.click();
    });

    expect(editor.isReviewPaneOpen()).toBe(true);
    expect(view.queryByRole('menu')).toBeNull();
    expect(view.getByTestId('review-draft')).toBeDefined();
  });

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

  const TRACKED = docx(
    '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
      '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
  );

  test('a reply to a tracked change renders inside that change, with no second card', async () => {
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
    expect(view.getAllByTestId('review-card')).toHaveLength(1);

    await act(async () => {
      editor.replyToReviewItem(editor.getReviewItems()[0]!.key, 'Why this wording?');
    });

    // STILL one card. OOXML gives `w:ins` no body, so the answer is written as a comment over
    // the change's own range — and before the two were linked it came back as a card of its
    // own, floating beside the change the reader was answering.
    expect(view.getAllByTestId('review-card')).toHaveLength(1);
    expect(view.getAllByTestId('review-card')[0]!.dataset.kind).toBe('insert');
    const replies = view.getAllByTestId('review-reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.textContent).toContain('Why this wording?');
    expect(replies[0]!.textContent).toContain('Grace Hopper');
  });

  test('a reply can be deleted on its own, and its control is scoped to the reply', async () => {
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
      editor.replyToReviewItem(editor.getReviewItems()[0]!.key, 'Why this wording?');
    });
    await act(async () => {
      editor.setActiveReviewItem(editor.getReviewItems().find((i) => i.kind === 'revision')!.key);
    });

    // TWO controls, one per node: the change's own and the reply's. Without the reply's, the
    // only way to take back a single answer was to delete the whole thread it hangs off.
    //
    // Both are always RENDERED; which one the reader can see is the stylesheet's business —
    // each is revealed by hovering the node it deletes, and the selectors that do it are
    // anchored on this structure. So the structure is what this asserts: the reply's control
    // lives inside the reply, and the change's inside the card's own head.
    expect(view.getAllByTestId('review-reply')).toHaveLength(1);
    const controls = view.getAllByTestId('review-delete');
    expect(controls).toHaveLength(2);
    const reply = view.getAllByTestId('review-reply')[0]!;
    expect(reply.contains(controls[1]!)).toBe(true);
    expect(reply.contains(controls[0]!)).toBe(false);
    expect(controls[0]!.closest('.docx-review__head')?.parentElement).toBe(
      view.getAllByTestId('review-card')[0]!
    );

    // And CLICKING the reply keeps the change open rather than closing it: the reply covers
    // exactly the change's characters, so it wins the innermost test at the caret, and
    // resolving to it would open an item the rail draws no card for.
    await act(async () => {
      fireEvent.click(view.getAllByTestId('review-reply')[0]!);
    });
    expect(view.getAllByTestId('review-card')[0]!.hasAttribute('data-active')).toBe(true);
    expect(view.getAllByTestId('review-delete')).toHaveLength(2);

    await act(async () => {
      fireEvent.click(controls[1]!);
    });
    // The reply is gone; the change it answered is not.
    expect(view.queryAllByTestId('review-reply')).toHaveLength(0);
    expect(view.getAllByTestId('review-card')).toHaveLength(1);
    expect(editor.surface!.session.bodyText()).toBe('base added');
  });

  test('a tracked change carries a delete control that discards the suggestion', async () => {
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
    // The rail had accept and reject for a change and nothing at all for a comment, so a
    // remark could be resolved but never removed. One control now sits on both kinds, without
    // the reader having to open the card first.
    expect(view.getAllByTestId('review-card')).toHaveLength(1);
    expect(view.getAllByTestId('review-delete')).toHaveLength(1);

    await act(async () => {
      fireEvent.click(view.getByTestId('review-delete'));
    });
    // Discarding a suggestion is rejecting it: the proposal goes, the base text stays.
    expect(view.queryAllByTestId('review-card')).toHaveLength(0);
    expect(editor.surface!.session.bodyText()).toBe('base ');
  });

  test('stops observing a card slot when the card unmounts', async () => {
    const original = globalThis.ResizeObserver;
    const observed: Element[] = [];
    const unobserved: Element[] = [];
    class ProbeResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe(target: Element) {
        observed.push(target);
      }
      unobserve(target: Element) {
        unobserved.push(target);
      }
      disconnect() {}
    }
    globalThis.ResizeObserver = ProbeResizeObserver as unknown as typeof ResizeObserver;
    try {
      const view = render(
        <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
          <DocxEditorViewport>
            <DocxEditorContent />
            <DocxEditorReview />
          </DocxEditorViewport>
        </DocxEditorRoot>
      );
      const slot = observed.find((node) => node.classList.contains('docx-review__slot'));
      expect(slot).toBeDefined();
      await act(async () => {
        fireEvent.click(view.getByTestId('review-delete'));
      });
      expect(unobserved.includes(slot!)).toBe(true);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  test('viewing mode disables review mutations with the read-only reason', async () => {
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
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });

    const actions = [
      view.getByTestId('review-accept'),
      view.getByTestId('review-reject'),
      view.getByTestId('review-delete'),
    ] as HTMLButtonElement[];
    for (const action of actions) {
      expect(action.disabled).toBe(true);
      expect(action.title).toBe('Read-only, no edits');
    }

    fireEvent.click(actions[0]!);
    expect(view.getAllByTestId('review-card')).toHaveLength(1);
    expect(editor.surface!.session.bodyText()).toBe('base added');
  });

  test('resolves and reopens a comment from the packaged card', async () => {
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
    expect(view.getByTestId('review-resolve')).toBeDefined();
    expect(view.queryByTestId('review-reopen')).toBeNull();

    await act(async () => {
      fireEvent.click(view.getByTestId('review-resolve'));
    });
    expect(commentOf(editor).resolved).toBe(true);
    expect(view.getByTestId('review-card').hasAttribute('data-resolved')).toBe(true);
    expect(view.queryByTestId('review-resolve')).toBeNull();
    expect(view.getByTestId('review-reopen')).toBeDefined();

    await act(async () => {
      fireEvent.click(view.getByTestId('review-reopen'));
    });
    expect(commentOf(editor).resolved).toBe(false);
    expect(view.getByTestId('review-resolve')).toBeDefined();
  });

  test('gives custom comment cards actions and the engine viewing refusal', async () => {
    let instance: DocxEditorInstance | null = null;

    function HostCommentCard() {
      const review = useReview();
      const item = review.items.find((entry) => entry.kind === 'comment');
      if (!item) return null;
      return (
        <div>
          <output data-testid="host-resolution-reason">
            {review.commentResolutionDisabledReason ?? ''}
          </output>
          <button
            data-testid="host-resolve"
            disabled={review.commentResolutionDisabledReason !== null}
            onClick={() => review.resolve(item)}
          >
            Resolve
          </button>
          <button
            data-testid="host-reopen"
            disabled={review.commentResolutionDisabledReason !== null}
            onClick={() => review.reopen(item)}
          >
            Reopen
          </button>
        </div>
      );
    }

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
          <HostCommentCard />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const editor = instance!;

    await act(async () => {
      fireEvent.click(view.getByTestId('host-resolve'));
    });
    expect(commentOf(editor).resolved).toBe(true);

    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    expect((view.getByTestId('host-resolve') as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByTestId('host-reopen') as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByTestId('host-resolution-reason').textContent).toBe(
      'the document is open for viewing'
    );
    fireEvent.click(view.getByTestId('host-reopen'));
    expect(commentOf(editor).resolved).toBe(true);
  });

  test('hides the read-only structural cards by default, and shows them on request', () => {
    // One resolvable insertion plus one structural site (a tracked row insertion,
    // `w:trPr/w:ins`) — the kind of markup a heavily revised contract carries by the dozen.
    const TRACKED = docx(
      '<w:p><w:r><w:t>base </w:t></w:r>' +
        '<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins></w:p>' +
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:trPr><w:ins w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"/></w:trPr>' +
        '<w:tc><w:tcPr/><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>' +
        '</w:tbl>'
    );
    const kindsOf = (root: HTMLElement) =>
      [...root.querySelectorAll('[data-testid="review-card"]')].map(
        (card) => (card as HTMLElement).dataset.kind
      );

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
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    // The ENGINE still lists the structural revision — only its card is hidden.
    expect(
      instance!
        .getReviewItems()
        .some((item) => item.kind === 'revision' && item.revisionKind === 'structural')
    ).toBe(true);
    expect(kindsOf(view.container)).toContain('insert');
    expect(kindsOf(view.container)).not.toContain('structural');
    view.unmount();

    const shown = render(
      <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview structural />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    expect(kindsOf(shown.container)).toContain('structural');
  });

  test('clicking a format or structural change opens its balloon; content changes stay rail-only', async () => {
    const TRACKED = docx(
      '<w:p><w:r><w:t>base </w:t></w:r>' +
        '<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins>' +
        '<w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr>' +
        '<w:t>restyled</w:t></w:r></w:p>' +
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:trPr><w:ins w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"/></w:trPr>' +
        '<w:tc><w:tcPr/><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>' +
        '</w:tbl>'
    );
    const view = render(
      <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    // FORMAT cards are out of the rail by default, like structural ones; the balloon —
    // not a hover — is where their decision lives.
    const railKinds = [...view.container.querySelectorAll('[data-testid="review-card"]')].map(
      (card) => (card as HTMLElement).dataset.kind
    );
    expect(railKinds).toContain('insert');
    expect(railKinds).not.toContain('format');
    expect(railKinds).not.toContain('structural');

    // Clicking the format-marked text opens its balloon, actions included, and it STAYS.
    const formatSpan = view.container.querySelector(
      '.docx-paginated-surface [data-revision-kind="format"]'
    )!;
    await act(async () => {
      fireEvent.mouseDown(formatSpan);
    });
    const balloon = view.getByTestId('review-balloon-card') as HTMLElement;
    expect(balloon.dataset.kind).toBe('format');
    expect(
      view.getByTestId('review-balloon').querySelector('[data-testid="review-accept"]')
    ).not.toBeNull();

    // A CONTENT change opens no balloon — its card is beside the page — and the press
    // closes whatever balloon was up.
    await act(async () => {
      fireEvent.mouseDown(
        view.container.querySelector(
          '.docx-paginated-surface [data-revision-id][data-revision-kind="insert"]'
        )!
      );
    });
    expect(view.queryByTestId('review-balloon')).toBeNull();

    // A tracked ROW is a structural site: its balloon opens on click, with actions.
    // These tests paint through the BUILT react adapter (`@docx-editor.dev/react` resolves
    // to packages/react/dist, which inlines the core painter) — a stale dist paints rows
    // without their attribution datasets and this balloon silently cannot open. If the
    // assertions below fail on attributes the source clearly paints, rebuild the adapter.
    const row = view.container.querySelector('.docx-table-row--revision') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.dataset.revisionKind).toBe('insert');
    await act(async () => {
      fireEvent.mouseDown(row);
    });
    const structuralBalloon = view.getByTestId('review-balloon-card') as HTMLElement;
    expect(structuralBalloon.dataset.kind).toBe('structural');
    expect(
      view.getByTestId('review-balloon').querySelector('[data-testid="review-accept"]')
    ).not.toBeNull();

    // A press outside any tracked change lets go.
    await act(async () => {
      fireEvent.mouseDown(view.container.querySelector('.docx-editor__scroll-container')!);
    });
    expect(view.queryByTestId('review-balloon')).toBeNull();
  });

  test('a crowded cluster collapses distant cards instead of spilling below', async () => {
    // Many changes packed line-on-line: their cards cannot all fit beside the text.
    // Push-down alone marched the tail pages below; collapse keeps the run bounded by
    // rendering distant cards as headers only.
    const CROWDED = docx(
      Array.from(
        { length: 60 },
        (_, index) => `<w:p><w:r><w:t>plain ${index}</w:t></w:r></w:p>`
      ).join('') +
        Array.from(
          { length: 16 },
          (_, index) =>
            `<w:p><w:ins w:id="${index + 1}" w:author="A${index}" ` +
            `w:date="2026-01-01T00:00:${String(index).padStart(2, '0')}Z">` +
            `<w:r><w:t>change ${index}</w:t></w:r></w:ins></w:p>`
        ).join('')
    );
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={CROWDED}
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
    const slots = [...view.container.querySelectorAll('.docx-review__slot')];
    expect(slots.length).toBe(16);
    const items = instance!.getReviewItems();
    const tops = slots.map((slot) => parseFloat((slot as HTMLElement).style.top));
    for (let index = 1; index < tops.length; index += 1) {
      expect(tops[index]!).toBeGreaterThan(tops[index - 1]!);
    }
    expect(slots.some((slot) => slot.hasAttribute('data-collapsed'))).toBe(true);

    const target = items[7]!;
    await act(async () => {
      instance!.setActiveReviewItem(target.key);
    });
    const activeSlot = view.container
      .querySelector('[data-testid="review-card"][data-active]')
      ?.closest('.docx-review__slot') as HTMLElement | null;
    expect(activeSlot).not.toBeNull();
    expect(activeSlot!.hasAttribute('data-collapsed')).toBe(false);
  });
});

const FORMAT_AND_INSERT = docx(
  '<w:p><w:r><w:rPr>' +
    '<w:rPrChange w:id="3" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z"><w:b/></w:rPrChange>' +
    '<w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:t>added text</w:t></w:r></w:ins></w:p>'
);

describe('DocxEditor.Review query exclusions', () => {
  test('default rail lists only non-format/non-structural cards', () => {
    const view = render(
      <DocxEditorRoot document={FORMAT_AND_INSERT} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    act(() => undefined);
    expect(view.getByTestId('review-rail').getAttribute('data-count')).toBe('1');
  });

  test('formatting and structural opt-ins list every card', () => {
    const view = render(
      <DocxEditorRoot document={FORMAT_AND_INSERT} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview structural formatting />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    act(() => undefined);
    expect(view.getByTestId('review-rail').getAttribute('data-count')).toBe('2');
  });
});

describe('DocxEditor.Review while the document is loading', () => {
  test('renders nothing — no rail, no empty state, no furniture — until bytes arrive', async () => {
    const compose = (document?: Uint8Array) => (
      <DocxEditorRoot {...(document ? { document } : {})} modules={[reviewModule()]}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview furniture={<div data-testid="host-furniture" />} />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    // The Root mounted before its document, the shape every fetching host has: the editor
    // instance exists, but there is nothing to review — and nothing to say "no comments
    // yet" about. The rail must not float its empty state over the host's loading screen.
    const view = render(compose());
    expect(view.queryByTestId('review-rail')).toBeNull();
    expect(view.queryByTestId('review-empty')).toBeNull();
    expect(view.queryByTestId('host-furniture')).toBeNull();

    await act(async () => {
      view.rerender(compose(SOURCE));
    });

    expect(view.getByTestId('review-rail')).toBeDefined();
    expect(view.getByTestId('review-empty')).toBeDefined();
    expect(view.getByTestId('host-furniture')).toBeDefined();

    // A parse failure clears `isLoading` (so a host can put its error screen up) while
    // still leaving no document. The rail must read that as "nothing to review", not as
    // a document — it floated its empty state over hosts' parse-error screens otherwise.
    await act(async () => {
      view.rerender(compose(strToU8('not a docx')));
    });

    expect(view.queryByTestId('review-rail')).toBeNull();
    expect(view.queryByTestId('host-furniture')).toBeNull();
  });

  test('a failed live load hides the rail — the failure emits only `error`', async () => {
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
    expect(view.getByTestId('review-rail')).toBeDefined();

    // The SAME editor instance, handed bytes that will not parse: the surface is torn
    // down and the facade emits ONLY `error` — no `change` fires for a failing load. The
    // rail (and the raw hook's `ready`) must hear that event, or they keep the previous
    // document's cards over a document that never opened.
    await act(async () => {
      instance!.load(strToU8('not a docx'));
    });

    expect(view.queryByTestId('review-rail')).toBeNull();
  });
});

/**
 * A document with an insertion, a deletion and a comment — three kinds that must not all
 * draw the same glyph in the closed rail's gutter.
 */
const THREE_KINDS = docx(
  '<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:t>added</w:t></w:r></w:ins></w:p>' +
    '<w:p><w:del w:id="2" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:delText>struck</w:delText></w:r></w:del></w:p>'
);

/**
 * An insertion and a deletion inside ONE paragraph: two markers whose anchors are the same
 * line, which the closed rail must stack rather than draw on top of each other.
 */
const SAME_LINE = docx(
  '<w:p><w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:t xml:space="preserve">added </w:t></w:r></w:ins>' +
    '<w:del w:id="2" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:delText>struck</w:delText></w:r></w:del></w:p>'
);

/** The glyph each marker drew, keyed by the kind it is for. */
function markerGlyphs(view: ReturnType<typeof render>): Map<string, string> {
  const glyphs = new Map<string, string>();
  for (const marker of view.queryAllByTestId('review-marker')) {
    const kind = marker.getAttribute('data-kind') ?? '';
    glyphs.set(kind, marker.querySelector('path')?.getAttribute('d') ?? '');
  }
  return glyphs;
}

describe('the collapsed rail says what each marker IS', () => {
  test('a marker draws the glyph for its kind, not one comment bubble for all of them', () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={THREE_KINDS}
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
    act(() => undefined);
    // Markers replace the cards only while the pane is CLOSED — that is the whole surface
    // under test, and it is the one a reader spends most of their time looking at.
    act(() => {
      instance!.exec({ type: 'toggleReviewPane' });
    });

    const glyphs = markerGlyphs(view);
    expect(glyphs.get('insert')).toBeTruthy();
    expect(glyphs.get('delete')).toBeTruthy();
    // The regression: every one of these used to be byte-identical.
    expect(glyphs.get('insert')).not.toBe(glyphs.get('delete'));
  });

  test('two markers anchored on one line stack instead of overlapping', () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={SAME_LINE}
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
    act(() => undefined);
    act(() => {
      instance!.exec({ type: 'toggleReviewPane' });
    });

    const tops = view
      .queryAllByTestId('review-marker')
      .map((marker) => Number.parseFloat((marker as HTMLElement).style.top));
    expect(tops.length).toBe(2);
    // Both anchors are the same line; drawn raw, the second marker sat exactly on the
    // first. Stacked, they are at least a marker's height (28px) apart.
    const sorted = [...tops].sort((a, b) => a - b);
    expect(sorted[1]! - sorted[0]!).toBeGreaterThanOrEqual(28);
  });

  test('the Markers part takes a per-item icon and keeps the wiring it was handed', () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={THREE_KINDS}
        modules={[reviewModule()]}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <DocxEditorReview.Markers
              icon={(item) => <span data-testid="host-glyph">{item.kind}</span>}
            />
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    act(() => undefined);
    act(() => {
      instance!.exec({ type: 'toggleReviewPane' });
    });

    // The host's glyph reached every marker...
    expect(view.queryAllByTestId('host-glyph').length).toBeGreaterThan(0);
    // ...and the override did NOT lose the anchoring the rail computed for it. Taken
    // verbatim, an override mounts with the default scale and no positioning, which stacks
    // every marker on top of the first.
    for (const marker of view.queryAllByTestId('review-marker')) {
      expect((marker as HTMLElement).style.position).toBe('absolute');
    }
  });
});
