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
