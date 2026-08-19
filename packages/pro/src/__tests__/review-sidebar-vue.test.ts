/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createSSRApp, defineComponent, h, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import {
  COMMENTED_SOURCE,
  FORMAT_AND_INSERT,
  SOURCE,
  TRACKED,
  assertNoRefOwnerWarnings,
  selectAllWithPlacement,
  docx,
  flush,
  mountReview,
  waitFor,
} from './review-vue-harness.ts';
import { DocxEditorReview } from '../vue/DocxEditorReview.tsx';
import { useReviewAuthor } from '../vue/index.ts';
import { reviewModule } from '../index.ts';
import { flush as flushMount, mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import { useReviewStableId } from '../vue/stable-id.ts';
import { DocxEditorAuthorStyle } from '../../../vue/src/editor/DocxEditorAuthorStyle.ts';
import type { ReviewItemView } from '../vue/useReview.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorReview (Vue)', () => {
  test('uses the default author ramp without declarations', async () => {
    const mounted = mountReview(TRACKED);
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('[data-testid="review-card"]') !== null);
      const card = mounted.container.querySelector('[data-testid="review-card"]') as HTMLElement;
      expect(card.dataset.reviewAuthorSlot).toBe('0');
      expect(card.style.getPropertyValue('--doc-review-author-current')).toBe(
        'var(--doc-review-author-0)'
      );
    } finally {
      mounted.unmount();
    }
  });

  test('exposes resolved author styles to custom Vue cards', async () => {
    const AuthorProbe = defineComponent({
      props: { author: { type: String, required: true } },
      setup(props) {
        const author = useReviewAuthor(() => props.author);
        return () =>
          h('span', {
            'data-testid': 'review-author-probe',
            'data-color': author.value?.color,
          });
      },
    });
    const mounted = mountEditorTree(
      () => [
        h(DocxEditorAuthorStyle, {
          author: 'Ada Lovelace',
          color: '#7c3aed',
        }),
      ],
      TRACKED,
      () => [
        h(DocxEditorReview, null, {
          default: () => [
            h(DocxEditorReview.List, null, {
              item: ({ item }: { item: ReviewItemView }) => h(AuthorProbe, { author: item.author }),
            }),
          ],
        }),
      ],
      [reviewModule()]
    );
    try {
      await flushMount();
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-author-probe"]') !== null
      );
      expect(
        mounted.container
          .querySelector('[data-testid="review-author-probe"]')
          ?.getAttribute('data-color')
      ).toBe('#7c3aed');
    } finally {
      mounted.unmount();
    }
  });

  test('uses the resolved author color and avatar from Vue declarations', async () => {
    const mounted = mountEditorTree(
      () => [
        h(DocxEditorAuthorStyle, {
          author: 'Ada Lovelace',
          color: '#7c3aed',
          avatarUrl: 'https://example.com/ada.png',
        }),
      ],
      TRACKED,
      () => [h(DocxEditorReview)],
      [reviewModule()]
    );
    try {
      await flushMount();
      await waitFor(() => mounted.container.querySelector('[data-testid="review-card"]') !== null);
      const card = mounted.container.querySelector('[data-testid="review-card"]') as HTMLElement;
      expect(card.dataset.reviewAuthor).toBe('Ada Lovelace');
      expect(card.style.getPropertyValue('--doc-review-author-current')).toBe('#7c3aed');
      const avatar = card.querySelector<HTMLImageElement>('.docx-review__avatar-img');
      expect(avatar?.src).toBe('https://example.com/ada.png');
      expect(avatar?.referrerPolicy).toBe('no-referrer');
      mounted.editor().exec({ type: 'toggleReviewPane' });
      await flushMount();
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-marker"]') !== null
      );
      const marker = mounted.container.querySelector(
        '[data-testid="review-marker"]'
      ) as HTMLElement;
      expect(marker.dataset.reviewAuthor).toBe('Ada Lovelace');
      expect(marker.style.getPropertyValue('--doc-review-author-current')).toBe('#7c3aed');
    } finally {
      mounted.unmount();
    }
  });

  test('emits no ref-owner warnings while the rail is active', async () => {
    const mounted = mountReview(TRACKED);
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('[data-testid="review-rail"]') !== null);
      await waitFor(() => mounted.container.querySelector('.docx-page') !== null);
      const editor = mounted.editor();
      await selectAllWithPlacement(editor);
      (
        mounted.container.querySelector('[data-testid="review-add-comment"]') as HTMLButtonElement
      ).click();
      await flush();
      assertNoRefOwnerWarnings(mounted.warnings);
      expect(mounted.container.querySelector('[data-testid="review-draft"]')).toBeTruthy();
      const slot = mounted.container.querySelector('.docx-review__slot') as HTMLElement;
      const draft = mounted.container.querySelector('[data-testid="review-draft"]') as HTMLElement;
      expect(slot.style.top).toMatch(/px$/);
      expect((draft.closest('.docx-review__slot') as HTMLElement).style.top).toMatch(/px$/);
    } finally {
      mounted.unmount();
    }
  });

  test('opens when the add-comment affordance starts a draft', async () => {
    const mounted = mountReview();
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('.docx-page') !== null);
      const editor = mounted.editor();
      editor.surface!.selectAll();
      editor.exec({ type: 'toggleReviewPane' });
      expect(editor.isReviewPaneOpen()).toBe(false);
      await flush();
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-add-comment"]') !== null
      );
      (
        mounted.container.querySelector('[data-testid="review-add-comment"]') as HTMLButtonElement
      ).click();
      await flush();
      expect(editor.isReviewPaneOpen()).toBe(true);
      expect(mounted.container.querySelector('[data-testid="review-draft"]')).toBeTruthy();
      assertNoRefOwnerWarnings(mounted.warnings);
    } finally {
      mounted.unmount();
    }
  });

  test('removes an open comment draft when the sidebar closes', async () => {
    const mounted = mountReview();
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('.docx-page') !== null);
      const editor = mounted.editor();
      editor.surface!.selectAll();
      editor.exec({ type: 'toggleReviewPane' });
      await flush();
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-add-comment"]') !== null
      );
      (
        mounted.container.querySelector('[data-testid="review-add-comment"]') as HTMLButtonElement
      ).click();
      await flush();
      expect(mounted.container.querySelector('[data-testid="review-draft"]')).toBeTruthy();
      editor.exec({ type: 'toggleReviewPane' });
      await flush();
      expect(mounted.container.querySelector('[data-testid="review-draft"]')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  test('lists existing comment cards from a commented document', async () => {
    const mounted = mountReview(COMMENTED_SOURCE);
    try {
      await flush();
      await waitFor(() => {
        const rail = mounted.container.querySelector('[data-testid="review-rail"]');
        return rail !== null && Number(rail.getAttribute('data-count')) > 0;
      });
      expect(
        mounted.container.querySelectorAll('[data-testid="review-card"]').length
      ).toBeGreaterThan(0);
      expect(mounted.container.textContent).toContain('Check this.');
    } finally {
      mounted.unmount();
    }
  });

  test('uses markers and one floating active card on a narrow viewport', async () => {
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const offsetDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return this.parentElement;
      },
    });
    const mounted = mountReview(COMMENTED_SOURCE);
    try {
      await flush();
      await waitFor(() => mounted.container.querySelector('.docx-page') !== null);
      mounted.editor().setZoom(1);
      await flush();
      await waitFor(
        () =>
          mounted.container
            .querySelector('[data-testid="review-rail"]')
            ?.hasAttribute('data-compact') === true
      );
      const rail = mounted.container.querySelector('[data-testid="review-rail"]') as HTMLElement;
      const viewport = mounted.container.querySelector(
        '.docx-editor__scroll-container'
      ) as HTMLElement;
      expect({
        compact: rail.hasAttribute('data-compact'),
        open: rail.hasAttribute('data-open'),
        start: viewport.style.getPropertyValue('--docx-review-gutter-start'),
        end: viewport.style.getPropertyValue('--docx-review-gutter'),
      }).toEqual({ compact: true, open: false, start: '44px', end: '44px' });
      const marker = mounted.container.querySelector(
        '[data-testid="review-marker"]'
      ) as HTMLButtonElement;
      expect(marker).toBeTruthy();
      expect(mounted.container.querySelector('.docx-review__list')).toBeNull();
      marker.click();
      await flush();
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-compact-card"]') !== null
      );
      const card = mounted.container.querySelector(
        '[data-testid="review-compact-card"]'
      ) as HTMLElement;
      expect(card.style.width).toBe('300px');
      expect(card.querySelector('[data-testid="review-card"]')).toBeTruthy();
    } finally {
      mounted.unmount();
      if (widthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
      } else {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      }
      if (offsetDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetDescriptor);
      } else {
        delete (HTMLElement.prototype as { offsetParent?: Element | null }).offsetParent;
      }
    }
  });

  test('submits a reply through ReviewReply and renders it with a delete control', async () => {
    const mounted = mountReview(TRACKED, {}, { author: 'Grace Hopper' });
    try {
      await flush();
      await waitFor(
        () => mounted.container.querySelectorAll('[data-testid="review-card"]').length === 1
      );
      const card = mounted.container.querySelector('[data-testid="review-card"]') as HTMLElement;
      card.click();
      await flush();
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-reply-input"]') !== null
      );
      const input = mounted.container.querySelector(
        '[data-testid="review-reply-input"]'
      ) as HTMLInputElement;
      expect(input).toBeTruthy();
      input.value = 'Why this wording?';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
      (
        mounted.container.querySelector('[data-testid="review-reply-submit"]') as HTMLButtonElement
      ).click();
      await waitFor(
        () => mounted.container.querySelectorAll('[data-testid="review-reply"]').length === 1
      );
      const reply = mounted.container.querySelector('[data-testid="review-reply"]')!;
      expect(reply.textContent).toContain('Why this wording?');
      expect(reply.querySelector('[data-testid="review-delete"]')).toBeTruthy();
      expect(mounted.container.querySelectorAll('[data-testid="review-card"]').length).toBe(1);
    } finally {
      mounted.unmount();
    }
  });

  test('a tracked change carries a delete control that discards the suggestion', async () => {
    const mounted = mountReview(TRACKED);
    try {
      await flush();
      expect(mounted.container.querySelectorAll('[data-testid="review-delete"]').length).toBe(1);
      (
        mounted.container.querySelector('[data-testid="review-delete"]') as HTMLButtonElement
      ).click();
      await waitFor(() => mounted.editor().getReviewItems().length === 0);
      await waitFor(
        () => mounted.container.querySelectorAll('[data-testid="review-card"]').length === 0
      );
      expect(mounted.editor().surface!.session.bodyText()).toBe('base ');
    } finally {
      mounted.unmount();
    }
  });

  test('default rail hides structural cards', async () => {
    const structural = docx(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:ins w:id="1" w:author="Ada"/></w:trPr>' +
        '<w:tc><w:p><w:r><w:t>row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    );
    const mounted = mountReview(structural);
    try {
      await flush();
      const cards = [...mounted.container.querySelectorAll('[data-testid="review-card"]')];
      expect(cards.every((card) => card.getAttribute('data-kind') !== 'structural')).toBe(true);
    } finally {
      mounted.unmount();
    }
  });

  test('default rail lists only non-format/non-structural cards', async () => {
    const mounted = mountReview(FORMAT_AND_INSERT);
    try {
      await flush();
      expect(
        mounted.container.querySelector('[data-testid="review-rail"]')?.getAttribute('data-count')
      ).toBe('1');
    } finally {
      mounted.unmount();
    }
  });

  test('formatting and structural opt-ins list every card', async () => {
    const mounted = mountReview(FORMAT_AND_INSERT, { structural: true, formatting: true });
    try {
      await flush();
      expect(
        mounted.container.querySelector('[data-testid="review-rail"]')?.getAttribute('data-count')
      ).toBe('2');
    } finally {
      mounted.unmount();
    }
  });

  test('renders nothing until bytes arrive', async () => {
    const mounted = mountReview(new Uint8Array(0));
    try {
      await flush();
      expect(mounted.container.querySelector('[data-testid="review-rail"]')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  test('clears viewport rail reservation when the review rail unmounts', async () => {
    const mounted = mountEditorTree(
      () => [],
      SOURCE,
      () => [h(DocxEditorReview)],
      [reviewModule()]
    );
    try {
      await flushMount();
      await waitFor(() => mounted.container.querySelector('.docx-page') !== null);
      await waitFor(() =>
        (
          mounted.container.querySelector('[data-testid="docx-editor-scroll"]') as HTMLElement
        ).hasAttribute('data-review-pane')
      );
      const scroller = mounted.container.querySelector(
        '[data-testid="docx-editor-scroll"]'
      ) as HTMLElement;
      expect(scroller.hasAttribute('data-review-pane')).toBe(true);
      mounted.viewportVisible.value = false;
      await flushMount();
      expect(scroller.hasAttribute('data-review-pane')).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  test('asChild merges rail wiring and keeps geometry listeners active', async () => {
    const mounted = mountEditorTree(
      () => [],
      TRACKED,
      () => [
        h(
          DocxEditorReview,
          { asChild: true },
          { default: () => h('div', { class: 'custom-rail-host' }) }
        ),
      ],
      [reviewModule()]
    );
    try {
      await flushMount();
      await waitFor(() => mounted.container.querySelector('.custom-rail-host') !== null);
      await waitFor(() => mounted.container.querySelector('[data-testid="review-card"]') !== null);
      const host = mounted.container.querySelector('.custom-rail-host') as HTMLElement;
      expect(host.getAttribute('data-testid')).toBe('review-rail');
      expect(host.classList.contains('docx-review')).toBe(true);
      expect(host.querySelector('[data-testid="review-card"]')).toBeTruthy();
      mounted.editor().exec({ type: 'toggleReviewPane' });
      await flushMount();
      expect(host.hasAttribute('data-open')).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  test('comment resolution reflects viewing mode after an edit-to-view switch', async () => {
    const mounted = mountReview(COMMENTED_SOURCE);
    try {
      await flush();
      await waitFor(
        () => mounted.container.querySelector('[data-testid="review-resolve"]') !== null
      );
      const editor = mounted.editor();
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      await flush();
      const resolve = mounted.container.querySelector(
        '[data-testid="review-resolve"]'
      ) as HTMLButtonElement;
      expect(resolve.disabled).toBe(true);
      expect(resolve.title).toBe('Read-only, no edits');
    } finally {
      mounted.unmount();
    }
  });

  test('releases retained selection when the rail unmounts during a draft', async () => {
    const mounted = mountEditorTree(
      () => [],
      SOURCE,
      () => [h(DocxEditorReview)],
      [reviewModule()]
    );
    try {
      await flushMount();
      await waitFor(() => mounted.container.querySelector('.docx-page') !== null);
      const editor = mounted.editor();
      let released = 0;
      const releaseSpy = editor.releaseSelection.bind(editor);
      editor.releaseSelection = () => {
        released++;
        return releaseSpy();
      };
      editor.surface!.selectAll();
      editor.exec({ type: 'toggleReviewPane' });
      await flushMount();
      (
        mounted.container.querySelector('[data-testid="review-add-comment"]') as HTMLButtonElement
      ).click();
      await flushMount();
      mounted.viewportVisible.value = false;
      await flushMount();
      expect(released).toBeGreaterThanOrEqual(1);
      expect(mounted.container.querySelector('[data-testid="review-draft"]')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });
});

describe('review stable ids', () => {
  test('useReviewStableId remains stable during hydration', async () => {
    const Probe = defineComponent({
      name: 'StableIdProbe',
      setup() {
        const id = useReviewStableId('probe');
        return () => h('div', { id, 'data-probe': '' });
      },
    });
    const ssrHtml = await renderToString(createSSRApp(Probe));
    const container = document.createElement('div');
    container.innerHTML = ssrHtml;
    document.body.appendChild(container);
    const ssrId = container.querySelector('[data-probe]')?.id;
    const app = createSSRApp(Probe);
    app.mount(container);
    await nextTick();
    const clientId = container.querySelector('[data-probe]')?.id;
    expect(clientId).toBe(ssrId);
    app.unmount();
    container.remove();
  });
});
