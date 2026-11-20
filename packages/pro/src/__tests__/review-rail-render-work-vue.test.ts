/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of `review-rail-render-work.test.tsx`: how much the review rail renders for a
// scroll and for a keystroke. A scroll that mounts no new card renders no card, and a
// keystroke renders only the card of the item it changed.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { defineComponent, h, ref } from 'vue';
import { DocxEditorReview, useReviewItem, type ReviewItemView } from '../vue/index.ts';
import { RAIL_BAND_STEP } from '../review/rail-window.ts';
import { insertBanner, installRailGeometry, railGeometry } from './review-rail-metrics-harness.ts';
import {
  INSIDE_INSERTION,
  compactCardTop,
  PAGES,
  counter,
  installViewHeight,
  mountedCards,
  scrollTo,
  scrollerOf,
  typeIn,
  unplaceItem,
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
  railGeometry.clientWidth = 1400;
});

describe('review rail render work (Vue)', () => {
  test('a scroll inside one band step renders nothing in the rail', async () => {
    const { container, templates, cards, rail, reset } = await mountCountingRail();
    const before = mountedCards(container);
    expect(before.length).toBeGreaterThan(0);
    expect(before.length).toBeLessThan(PAGES);

    reset();
    const scroller = scrollerOf(container);
    for (const top of [20, 40, 60, 80]) {
      scrollTo(scroller, top);
      await settle();
    }
    expect(rail.keys()).toEqual([]);
    expect(templates.total()).toBe(0);
    expect(cards.total()).toBe(0);
    expect(mountedCards(container)).toEqual(before);
  });

  test('a scroll that mounts new cards renders only those cards', async () => {
    const { container, templates, cards, reset } = await mountCountingRail();
    const before = mountedCards(container);

    reset();
    const scroller = scrollerOf(container);
    // One band step at a time, until a card that was not mounted is.
    let top = 0;
    let after = before;
    while (after.every((key) => before.includes(key)) && top < 20000) {
      top += RAIL_BAND_STEP;
      scrollTo(scroller, top);
      await settle();
      after = mountedCards(container);
    }
    const entered = after.filter((key) => !before.includes(key));
    const stayed = after.filter((key) => before.includes(key));
    expect(entered.length).toBeGreaterThan(0);
    expect(stayed.length).toBeGreaterThan(0);
    for (const key of stayed) {
      expect(templates.of(key)).toBe(0);
      expect(cards.of(key)).toBe(0);
    }
    for (const key of entered) expect(templates.of(key)).toBe(1);
  });

  test('a keystroke renders only the card of the item it changed', async () => {
    const { container, editor, templates, cards, reset } = await mountCountingRail();
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);

    // Paragraph 0 is plain text: no item changes, so no card renders.
    reset();
    let changes = typeIn(editor, 0);
    await settle();
    expect(changes).toBeGreaterThan(0);
    expect(templates.total()).toBe(0);
    expect(cards.total()).toBe(0);

    // Inside the first tracked insertion: its card shows the new text, and no other renders.
    reset();
    changes = typeIn(editor, 1, INSIDE_INSERTION);
    await settle();
    expect(changes).toBeGreaterThan(0);
    expect(container.querySelector(`[data-card-key="${mounted[0]!}"]`)?.textContent).toContain(
      'adxded 0'
    );
    expect(templates.keys()).toEqual([mounted[0]!]);
    expect(cards.keys()).toEqual([mounted[0]!]);
  });

  test('a card that moves keeps its content without a render', async () => {
    const { container, templates, cards, reset } = await mountCountingRail();
    const slots = () =>
      [...container.querySelectorAll<HTMLElement>('.docx-review__slot')].map(
        (slot) => slot.style.top
      );
    const before = slots();
    expect(before.length).toBeGreaterThan(1);

    // Content above the pages moves the rail's offset, so each mounted card takes a new
    // position while no item changes.
    reset();
    insertBanner(scrollerOf(container));
    await waitFor(() => slots().some((top) => !before.includes(top)));
    const after = slots();
    expect(after.some((top) => !before.includes(top))).toBe(true);
    expect(templates.total()).toBe(0);
    expect(cards.total()).toBe(0);
  });

  test('a reply renders the card it belongs to, and no other', async () => {
    const { container, editor, cards, reset } = await mountCountingRail();
    const [first] = mountedCards(container);
    const card = () => container.querySelector(`[data-card-key="${first!}"]`)!;

    // From an author the rail already lists: a new author changes every card's colour slots.
    reset();
    expect(editor.replyToReviewItem(first!, 'first answer', 'Ada Lovelace').ok).toBe(true);
    await settle();
    expect(card().querySelector('[data-testid="review-reply"]')?.textContent).toContain(
      'first answer'
    );
    expect(cards.keys()).toEqual([first!]);

    // An edit of the reply reaches the card through the card's own replies.
    const reply = editor.getReviewItems().find((entry) => entry.text === 'first answer')!;
    reset();
    expect(editor.setCommentText(reply.key, 'second answer').ok).toBe(true);
    await settle();
    expect(card().querySelector('[data-testid="review-reply"]')?.textContent).toContain(
      'second answer'
    );
    expect(cards.keys()).toEqual([first!]);
  });

  test('a card template renders its parts only for the item that changed', async () => {
    let labels: string[] = [];
    const t = ((key: string): string | undefined => {
      if (key !== 'review.ariaLabel') labels.push(key);
      return undefined;
    }) as (key: string) => string;
    const { container, editor } = await mountRail(() =>
      h(DocxEditorReview, { t }, () =>
        h(DocxEditorReview.List, null, () =>
          h(DocxEditorReview.Card, { className: 'host-card' }, () => [
            h(DocxEditorReview.Reply, { hidden: true }),
            h('span', { 'data-testid': 'host-extra' }),
          ])
        )
      )
    );
    const mounted = container.querySelectorAll('.host-card').length;
    expect(mounted).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-testid="host-extra"]')).toHaveLength(mounted);

    labels = [];
    typeIn(editor, 0);
    await settle();
    scrollTo(scrollerOf(container), 40);
    await settle();
    expect(labels).toEqual([]);

    // One card changes: each label is asked for once per render of that card, not per card.
    typeIn(editor, 1, INSIDE_INSERTION);
    await settle();
    const accepts = labels.filter((key) => key === 'review.accept').length;
    expect(accepts).toBe(1);
  });

  test('the compact card of an item without a placement follows each scroll position', async () => {
    // Too narrow for the column: the rail shows markers and floats the active item's card.
    railGeometry.clientWidth = 1000;
    const { container, editor } = await mountRail(() => h(DocxEditorReview), {
      ready: 'review-marker',
    });
    expect(
      container.querySelector('[data-testid="review-rail"]')?.hasAttribute('data-compact')
    ).toBe(true);
    const first = editor.getReviewItems()[0]!.key;
    const restoreRead = unplaceItem(editor, first);
    expect(editor.setActiveReviewItem(first, { reveal: false }).ok).toBe(true);
    await waitFor(() => compactCardTop(container) !== null);
    const start = compactCardTop(container)!;

    // The card stands on the band's own edge, so it moves with each position, not each step.
    const scroller = scrollerOf(container);
    for (const top of [20, 40]) {
      scrollTo(scroller, top);
      await settle();
      expect(compactCardTop(container)).toBe(start + top);
    }
    restoreRead();
  });

  test('state that the item slot reads renders each mounted card once', async () => {
    const calls = counter();
    const label = ref('one');
    const { container } = await mountRail(() =>
      h(DocxEditorReview, null, {
        item: ({ item }: { item: ReviewItemView }) => {
          calls.add(item.key);
          return h('div', { 'data-card-key': item.key, 'data-label': label.value }, [
            h(DocxEditorReview.Card),
          ]);
        },
      })
    );
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);

    calls.reset();
    label.value = 'two';
    await settle();
    for (const key of mounted) expect(calls.of(key)).toBe(1);
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted.length);
  });

  test('an item slot adds no node of the rail around its own nodes', async () => {
    /** The children of the first slot element: a tag name, or `#text` with its text. */
    const childrenOf = (container: Element) =>
      [...container.querySelector('.docx-review__slot')!.childNodes].map((node) =>
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element).localName
          : `${node.nodeName}:${node.textContent}`
      );
    // The slot element holds one keyed fragment, which Vue marks with an empty text node at
    // each end. Between them stand the nodes of the slot, and nothing else.
    const one = await mountRail(() =>
      h(DocxEditorReview, null, {
        item: () => h('article', null, [h(DocxEditorReview.Card)]),
      })
    );
    expect(childrenOf(one.container)).toEqual(['#text:', 'article', '#text:']);
    unmountRails();

    const two = await mountRail(() =>
      h(DocxEditorReview, null, {
        item: () => [h('article', null, [h(DocxEditorReview.Card)]), h('footer'), 'note'],
      })
    );
    expect(childrenOf(two.container)).toEqual([
      '#text:',
      'article',
      'footer',
      '#text:note',
      '#text:',
    ]);
  });

  test('an item slot that changes the order of its keyed roots moves their elements', async () => {
    const flipped = ref(false);
    const { container } = await mountRail(() =>
      h(DocxEditorReview, null, {
        item: ({ item }: { item: ReviewItemView }) => {
          const roots = [
            h('div', { key: 'a', 'data-card-key': item.key }, [
              h('input', { 'data-testid': 'host-input' }),
              h(DocxEditorReview.Card),
            ]),
            h('hr', { key: 'b' }),
          ];
          return flipped.value ? roots.reverse() : roots;
        },
      })
    );
    const [first] = mountedCards(container);
    const root = () => container.querySelector<HTMLElement>(`[data-card-key="${first!}"]`)!;
    const field = () => root().querySelector<HTMLInputElement>('[data-testid="host-input"]')!;
    /** The element children of the slot of the first card, by tag name. */
    const order = () => [...root().parentElement!.children].map((child) => child.localName);
    expect(order()).toEqual(['div', 'hr']);

    // What a reader holds in the card: the element, the text typed in it, and the focus.
    const before = { root: root(), field: field(), rule: root().nextElementSibling };
    before.field.focus();
    before.field.value = 'typed text';
    expect(document.activeElement).toBe(before.field);

    flipped.value = true;
    await settle();
    expect(order()).toEqual(['hr', 'div']);
    expect(root()).toBe(before.root);
    expect(field()).toBe(before.field);
    expect(root().previousElementSibling).toBe(before.rule);
    expect(field().value).toBe('typed text');
    expect(document.activeElement).toBe(before.field);
  });

  test('another item slot function renders each mounted card once', async () => {
    const calls = counter();
    // Plain values: the slot reads no reactive state, so only its identity tells of a change.
    let label = 'one';
    const epoch = ref(0);
    const Host = defineComponent({
      name: 'Host',
      setup() {
        return () => {
          void epoch.value;
          const shown = label;
          return h(DocxEditorReview, null, {
            item: ({ item }: { item: ReviewItemView }) => {
              calls.add(item.key);
              return h('div', { 'data-card-key': item.key, 'data-label': shown }, [
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
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(mounted.length);

    // The host renders again and passes a new slot function over the new value.
    calls.reset();
    label = 'two';
    epoch.value += 1;
    await settle();
    for (const key of mounted) expect(calls.of(key)).toBe(1);
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted.length);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(0);
  });

  test('another default slot with a Card renders each mounted card once', async () => {
    const renders = counter();
    const Probe = defineComponent({
      name: 'Probe',
      props: { label: { type: String, required: true } },
      setup(props) {
        const item = useReviewItem();
        return () => {
          renders.add(item.value!.key);
          return h('span', { 'data-testid': 'host-extra', 'data-label': props.label });
        };
      },
    });
    let label = 'one';
    const epoch = ref(0);
    const Host = defineComponent({
      name: 'Host',
      setup() {
        return () => {
          void epoch.value;
          const shown = label;
          return h(DocxEditorReview, null, () =>
            h(DocxEditorReview.List, null, () =>
              h(DocxEditorReview.Card, { className: 'host-card' }, () => [
                h(DocxEditorReview.Summary),
                h(Probe, { label: shown }),
              ])
            )
          );
        };
      },
    });
    const { container } = await mountRail(() => h(Host));
    const mounted = container.querySelectorAll('.host-card').length;
    expect(mounted).toBeGreaterThan(1);
    expect(renders.keys()).toHaveLength(mounted);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(mounted);

    const cards = renders.keys();
    renders.reset();
    label = 'two';
    epoch.value += 1;
    await settle();
    for (const key of cards) expect(renders.of(key)).toBe(1);
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(0);
  });

  test('a change of the rail settings renders every mounted card', async () => {
    const { container, editor, cards, reset } = await mountCountingRail();
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);
    const accepts = () => [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="review-accept"]'),
    ];
    expect(accepts().some((button) => button.disabled)).toBe(false);

    // Viewing mode is not an item's data, but each card's actions follow it.
    reset();
    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    await settle();
    expect(accepts()).toHaveLength(mounted.length);
    expect(accepts().every((button) => button.disabled)).toBe(true);
    for (const key of mounted) expect(cards.of(key)).toBeGreaterThan(0);
  });

  test('the packaged card renders no part for a keystroke that changes no item', async () => {
    // The packaged parts ask the host's resolver for their labels on each render, so its
    // calls count the renders of the parts. The rail element asks for its own name on each
    // of its renders; that one is not a card's.
    let labels: string[] = [];
    // It answers nothing, so each part falls back to the bundled label.
    const t = ((key: string): string | undefined => {
      if (key !== 'review.ariaLabel') labels.push(key);
      return undefined;
    }) as (key: string) => string;
    const { container, editor } = await mountRail(() => h(DocxEditorReview, { t }));
    expect(labels).toContain('review.accept');

    labels = [];
    const changes = typeIn(editor, 0);
    await settle();
    expect(changes).toBeGreaterThan(0);
    scrollTo(scrollerOf(container), 40);
    await settle();
    expect(labels).toEqual([]);
  });
});
