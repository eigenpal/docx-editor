/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of `review-rail-host-renders.test.tsx`: what the review rail does when its
// host renders again with a slot function it makes anew on each render, with another
// document, and after the host hid the rail. `review-rail-template-host-vue.test.ts` covers
// a host written as a template.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { defineComponent, h, ref } from 'vue';
import { DocxEditorReview, type ReviewItemView } from '../vue/index.ts';
import { installRailGeometry } from './review-rail-metrics-harness.ts';
import {
  AUTHOR,
  INSIDE_INSERTION,
  authorsOf,
  cardOf,
  counter,
  installViewHeight,
  mountedCards,
  pagedTrackedDocument,
  typeIn,
} from './review-rail-render-work-harness.ts';
import {
  mountCountingRail,
  mountRail,
  settle,
  unmountRails,
  waitFor,
} from './review-rail-render-work-vue-harness.ts';

let restore: (() => void)[] = [];
beforeAll(() => {
  restore = [installRailGeometry(), installViewHeight()];
});
afterAll(() => {
  for (const undo of restore) undo();
});
afterEach(() => {
  unmountRails();
});

const OTHER_AUTHOR = 'Grace Hopper';

describe('review rail and the renders of its host (Vue)', () => {
  test('an inline slot function runs once per card on each render of the host', async () => {
    const calls = counter();
    /** A child with state of its own, to tell a render of the card from a new mount. */
    const Presses = defineComponent({
      name: 'Presses',
      setup() {
        const presses = ref(0);
        return () =>
          h('button', {
            type: 'button',
            'data-testid': 'press',
            'data-presses': presses.value,
            onClick: () => {
              presses.value += 1;
            },
          });
      },
    });
    const ticks = ref(0);
    const Host = defineComponent({
      name: 'Host',
      setup() {
        return () => {
          // A plain value: the slot function, new on each render, is the only sign of it.
          const shown = ticks.value;
          return h(DocxEditorReview, null, {
            item: ({ item }: { item: ReviewItemView }) => {
              calls.add(item.key);
              return h('div', { 'data-card-key': item.key, 'data-ticks': shown }, [
                h(Presses),
                h(DocxEditorReview.Card),
              ]);
            },
          });
        };
      },
    });
    const { container } = await mountRail(() => h(Host));
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);
    const first = container.querySelector<HTMLElement>(`[data-card-key="${mounted[0]!}"]`)!;
    const press = () => first.querySelector<HTMLElement>('[data-testid="press"]')!;
    press().click();
    await settle();
    expect(press().dataset.presses).toBe('1');

    // The cost of an inline slot function: every mounted card renders for each host render.
    for (let next = 1; next <= 5; next += 1) {
      calls.reset();
      ticks.value = next;
      await settle();
      for (const key of mounted) expect(calls.of(key)).toBe(1);
      expect(container.querySelectorAll(`[data-ticks="${next}"]`)).toHaveLength(mounted.length);
    }
    // The cards rendered. They did not mount again: the element and its state are the same.
    expect(container.querySelector(`[data-card-key="${mounted[0]!}"]`)).toBe(first);
    expect(press().dataset.presses).toBe('1');
  });

  test('a new document loaded into the same editor shows only the cards of that document', async () => {
    const { container, editor, templates, reset } = await mountCountingRail();
    const before = mountedCards(container);
    expect(before.length).toBeGreaterThan(1);
    expect(authorsOf(container)).toEqual([AUTHOR]);

    reset();
    editor.load(pagedTrackedDocument(() => OTHER_AUTHOR));
    await waitFor(() => authorsOf(container).includes(OTHER_AUTHOR));
    await settle(60);
    const after = mountedCards(container);
    expect(after.length).toBeGreaterThan(1);
    expect(after.filter((key) => before.includes(key))).toEqual([]);
    expect(authorsOf(container)).toEqual([OTHER_AUTHOR]);
    // Each card is of an item of the new document, and no call was for an item of the old one.
    const current = new Set(editor.getReviewItems().map((entry) => entry.key));
    expect(after.every((key) => current.has(key))).toBe(true);
    expect(templates.keys().filter((key) => before.includes(key))).toEqual([]);
  });

  test('a rail hidden and shown again shows the cards as they are now', async () => {
    const hidden = ref(false);
    const { container, editor } = await mountCountingRail({
      props: () => ({ hidden: hidden.value }),
    });
    const [first, second] = mountedCards(container);
    expect(second).toBeDefined();

    hidden.value = true;
    await settle();
    expect(container.querySelector('[data-testid="review-rail"]')).toBeNull();
    expect(mountedCards(container)).toEqual([]);

    // While the rail is hidden: one change gets new text and a reply, and another leaves.
    typeIn(editor, 1, INSIDE_INSERTION);
    expect(editor.replyToReviewItem(first!, 'said while hidden', AUTHOR).ok).toBe(true);
    expect(editor.acceptReviewItem(second!).ok).toBe(true);
    await settle();

    hidden.value = false;
    await waitFor(() => mountedCards(container).length > 0);
    await settle(60);
    const shown = mountedCards(container);
    expect(shown[0]).toBe(first!);
    expect(shown).not.toContain(second!);
    const current = new Set(editor.getReviewItems().map((entry) => entry.key));
    expect(shown.every((key) => current.has(key))).toBe(true);
    const card = cardOf(container, first!)!;
    expect(card.textContent).toContain('adxded 0');
    expect(card.querySelector('[data-testid="review-reply"]')?.textContent).toContain(
      'said while hidden'
    );
  });
});
