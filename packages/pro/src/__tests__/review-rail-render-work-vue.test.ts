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
import { h, type App, type ComponentPublicInstance, type VNode } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { flush, mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import { reviewModule } from '../index.ts';
import { DocxEditorReview, type ReviewItemView } from '../vue/index.ts';
import { RAIL_BAND_STEP } from '../review/rail-window.ts';
import { insertBanner, installRailGeometry } from './review-rail-metrics-harness.ts';
import {
  INSIDE_INSERTION,
  PAGES,
  installViewHeight,
  mountedCards,
  pagedTrackedDocument,
  scrollTo,
  scrollerOf,
  typeIn,
} from './review-rail-render-work-harness.ts';

let restore: (() => void)[] = [];
beforeAll(() => {
  restore = [installRailGeometry(), installViewHeight()];
});
afterAll(() => {
  for (const undo of restore) undo();
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await flush();
}

async function waitFor(predicate: () => boolean, attempts = 80): Promise<void> {
  for (let i = 0; i < attempts && !predicate(); i++) await settle(25);
}

/** Render counts by card key, since the last `reset`. */
function counter() {
  const counts = new Map<string, number>();
  return {
    add: (key: string) => void counts.set(key, (counts.get(key) ?? 0) + 1),
    of: (key: string) => counts.get(key) ?? 0,
    total: () => [...counts.values()].reduce((sum, count) => sum + count, 0),
    keys: () => [...counts.keys()],
    reset: () => counts.clear(),
  };
}

type Counter = ReturnType<typeof counter>;

/**
 * Count each component that mounts or updates inside the rail: in `cards` by the card it
 * belongs to, and in `rail` when it belongs to no card.
 */
function countRenders(app: App, cards: Counter, rail: Counter): void {
  const record = (instance: ComponentPublicInstance): void => {
    const node = instance.$el as Node | null;
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    if (!element?.closest('.docx-review')) return;
    const card = element.closest<HTMLElement>('[data-card-key]');
    if (card) cards.add(card.dataset.cardKey!);
    else rail.add(instance.$options.name ?? 'component');
  };
  app.mixin({
    mounted() {
      record(this as ComponentPublicInstance);
    },
    updated() {
      record(this as ComponentPublicInstance);
    },
  });
}

async function mountRail(review: () => VNode, configure?: (app: App) => void) {
  const mounted = mountEditorTree(
    () => [],
    pagedTrackedDocument(),
    () => [review()],
    [reviewModule()],
    // The author of the document's changes, so a reply adds no author and can be edited.
    { author: 'Ada Lovelace' },
    undefined,
    configure
  );
  unmount = mounted.unmount;
  const { container } = mounted;
  await waitFor(() => container.querySelector('[data-testid="review-card"]') !== null);
  await settle(60);
  return { container, editor: mounted.editor() as DocxEditorInstance };
}

/**
 * A rail whose cards come from an item slot. `templates` counts the calls of the slot,
 * `cards` the renders of the components of each card, and `rail` the renders of the rail's
 * own components.
 */
async function mountCountingRail() {
  const templates = counter();
  const cards = counter();
  const rail = counter();
  const slots = {
    item: ({ item }: { item: ReviewItemView }) => {
      templates.add(item.key);
      return h('div', { 'data-card-key': item.key }, [h(DocxEditorReview.Card)]);
    },
  };
  const mounted = await mountRail(
    () => h(DocxEditorReview, null, slots),
    (app) => countRenders(app, cards, rail)
  );
  const reset = () => {
    templates.reset();
    cards.reset();
    rail.reset();
  };
  return { ...mounted, templates, cards, rail, reset };
}

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
    expect(accepts).toBeGreaterThan(0);
    expect(accepts).toBeLessThan(mounted);
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
