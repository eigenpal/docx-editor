/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue compact rail's floating card uses the SAME card template as the List: the List
// part's item slot, its `Card` part, or its part overrides plus host children. The React
// twin is review-compact-card.test.tsx.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { defineComponent, h, type VNode } from 'vue';
import { COMMENTED_SOURCE, flush, waitFor } from './review-vue-harness.ts';
import { DocxEditorReview, useReviewItem } from '../vue/index.ts';
import { reviewModule } from '../index.ts';
import { mountEditorTree } from '../../../vue/test/helpers/mount.ts';

// A 1000px scroller is too narrow for the full column beside a 100% page, so the rail goes
// compact; `offsetParent` lets the rail place its floating card.
let widthDescriptor: PropertyDescriptor | undefined;
let offsetDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  offsetDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});

afterAll(() => {
  if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
  else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  if (offsetDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetDescriptor);
  } else {
    delete (HTMLElement.prototype as { offsetParent?: Element | null }).offsetParent;
  }
});

const HostThread = defineComponent({
  name: 'HostThread',
  setup() {
    const item = useReviewItem();
    return () => h('div', { 'data-testid': 'host-thread' }, item.value?.text ?? '');
  },
});

async function openCompactCard(review: () => VNode): Promise<{
  card: HTMLElement;
  unmount: () => void;
}> {
  const mounted = mountEditorTree(
    () => [],
    COMMENTED_SOURCE,
    () => [review()],
    [reviewModule()]
  );
  await flush();
  await waitFor(() => mounted.container.querySelector('.docx-page') !== null);
  mounted.editor().setZoom(1);
  await flush();
  const rail = () => mounted.container.querySelector('[data-testid="review-rail"]');
  await waitFor(() => rail()?.hasAttribute('data-compact') === true);
  expect(rail()?.hasAttribute('data-compact')).toBe(true);
  const marker = mounted.container.querySelector(
    '[data-testid="review-marker"]'
  ) as HTMLButtonElement;
  expect(marker).toBeTruthy();
  marker.click();
  await flush();
  const card = () =>
    mounted.container.querySelector('[data-testid="review-compact-card"]') as HTMLElement | null;
  await waitFor(() => card() !== null);
  expect(card()).not.toBeNull();
  return { card: card()!, unmount: mounted.unmount };
}

describe('the compact card (Vue)', () => {
  test('the packaged card shows its reply box when the host supplies no template', async () => {
    const { card, unmount } = await openCompactCard(() => h(DocxEditorReview));
    try {
      expect(card.querySelector('[data-testid="review-reply-input"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  test('renders the List part overrides and host children', async () => {
    const { card, unmount } = await openCompactCard(() =>
      h(
        DocxEditorReview,
        { card: { className: 'host-card' } },
        {
          default: () => [
            h(DocxEditorReview.List, null, {
              default: () => [
                h(DocxEditorReview.Replies, { hidden: true }),
                h(DocxEditorReview.Reply, { hidden: true }),
                h(HostThread),
              ],
            }),
            h(DocxEditorReview.Markers),
          ],
        }
      )
    );
    try {
      expect(card.querySelector('[data-testid="host-thread"]')?.textContent).toBe('Check this.');
      expect(card.querySelector('[data-testid="review-reply-input"]')).toBeNull();
      expect(
        card.querySelector('[data-testid="review-card"]')?.classList.contains('host-card')
      ).toBe(true);
    } finally {
      unmount();
    }
  });

  test('uses the List part item slot', async () => {
    const { card, unmount } = await openCompactCard(() =>
      h(DocxEditorReview, null, {
        default: () => [
          h(DocxEditorReview.List, null, {
            item: ({ item }: { item: { text: string } }) =>
              h('div', { 'data-testid': 'host-render' }, item.text),
          }),
          h(DocxEditorReview.Markers),
        ],
      })
    );
    try {
      expect(card.querySelector('[data-testid="host-render"]')?.textContent).toBe('Check this.');
      expect(card.querySelector('[data-testid="review-card"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});
