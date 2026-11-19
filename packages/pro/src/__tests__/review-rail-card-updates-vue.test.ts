/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of `review-rail-card-updates.test.tsx`: a card that renders only for its own
// data still shows each change that concerns it. Each case checks what the reader sees, and
// that the cards the change does not concern did not render.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { h, shallowRef, type VNode } from 'vue';
import { LocaleProvider } from '@docx-editor.dev/vue';
import { RAIL_BAND_STEP } from '../review/rail-window.ts';
import { installRailGeometry } from './review-rail-metrics-harness.ts';
import {
  AUTHOR,
  cardOf,
  commentOn,
  installViewHeight,
  mountedCards,
  pagedTrackedDocument,
  scrollTo,
  scrollerOf,
} from './review-rail-render-work-harness.ts';
import {
  mountCountingRail,
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
const ACCENT = '--doc-review-author-current';

describe('review rail cards follow their data (Vue)', () => {
  test('the active card changes and clears', async () => {
    const { container, editor, cards, reset } = await mountCountingRail();
    const [first, second, ...others] = mountedCards(container);
    expect(second).toBeDefined();
    const active = () =>
      mountedCards(container).filter((key) => cardOf(container, key)?.hasAttribute('data-active'));
    const activate = async (key: string | null) => {
      reset();
      expect(editor.setActiveReviewItem(key, { reveal: false }).ok).toBe(true);
      await settle();
    };

    await activate(first!);
    expect(active()).toEqual([first!]);
    expect(cards.keys()).toEqual([first!]);

    await activate(second!);
    expect(active()).toEqual([second!]);
    expect(cards.keys().sort()).toEqual([first!, second!].sort());

    await activate(null);
    expect(active()).toEqual([]);
    expect(cards.keys()).toEqual([second!]);
    for (const key of others) expect(cards.of(key)).toBe(0);
  });

  test('another host resolver and another locale change the labels of each card', async () => {
    const t = shallowRef<((key: string) => string) | undefined>(undefined);
    const catalog = shallowRef<{ review: { accept: string } } | undefined>(undefined);
    const { container, templates } = await mountCountingRail({
      props: () => (t.value ? { t: t.value } : {}),
      // One provider from the start: another catalog then changes it, and mounts nothing again.
      wrap: (root: VNode) => h(LocaleProvider, { i18n: catalog.value }, { default: () => [root] }),
    });
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);
    const labels = () =>
      mounted.map((key) =>
        cardOf(container, key)
          ?.querySelector('[data-testid="review-accept"]')
          ?.getAttribute('aria-label')
      );
    expect(labels()).toEqual(mounted.map(() => 'Accept'));

    // The host's resolver.
    t.value = ((key: string) => (key === 'review.accept' ? 'Take' : undefined)) as (
      key: string
    ) => string;
    await settle();
    expect(labels()).toEqual(mounted.map(() => 'Take'));

    // Without it, the catalog of the locale answers.
    t.value = undefined;
    await settle();
    templates.reset();
    catalog.value = { review: { accept: 'Annehmen' } };
    await settle();
    expect(labels()).toEqual(mounted.map(() => 'Annehmen'));
    // The labels are the parts' own: the item slot did not run for them.
    expect(templates.total()).toBe(0);
  });

  test('an author style and a new author restyle the cards of that author', async () => {
    const { container, editor } = await mountCountingRail({
      source: pagedTrackedDocument((page) => (page % 2 === 0 ? AUTHOR : OTHER_AUTHOR)),
    });
    const mounted = mountedCards(container);
    const authorOf = (key: string) => cardOf(container, key)!.dataset.reviewAuthor!;
    const accentOf = (key: string) => cardOf(container, key)!.style.getPropertyValue(ACCENT);
    const mine = mounted.filter((key) => authorOf(key) === AUTHOR);
    const theirs = mounted.filter((key) => authorOf(key) === OTHER_AUTHOR);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    const before = new Map(mounted.map((key) => [key, accentOf(key)]));

    editor.setRevisionStyles({ authors: { [OTHER_AUTHOR]: '#0b7285' } });
    await settle();
    for (const key of theirs) expect(accentOf(key)).toBe('#0b7285');
    for (const key of mine) expect(accentOf(key)).toBe(before.get(key)!);

    // A reviewer the document did not list joins with a reply: the reply carries the author.
    expect(editor.replyToReviewItem(mine[0]!, 'a new voice', 'Alan Turing').ok).toBe(true);
    await settle();
    const reply = cardOf(container, mine[0]!)!.querySelector<HTMLElement>(
      '[data-testid="review-reply"]'
    )!;
    expect(reply.textContent).toContain('a new voice');
    expect(reply.dataset.reviewAuthor).toBe('Alan Turing');
    editor.setRevisionStyles({
      authors: { [OTHER_AUTHOR]: '#0b7285', 'Alan Turing': '#862e9c' },
    });
    await settle();
    expect(
      cardOf(container, mine[0]!)!
        .querySelector<HTMLElement>('[data-testid="review-reply"]')!
        .style.getPropertyValue(ACCENT)
    ).toBe('#862e9c');
    for (const key of theirs) expect(accentOf(key)).toBe('#0b7285');
  });

  test('a comment resolves, reopens, and leaves', async () => {
    const { container, editor, cards, reset } = await mountCountingRail();
    const changes = mountedCards(container);
    const comment = commentOn(editor, 0, 'please check');
    await settle();
    expect(cardOf(container, comment)?.textContent).toContain('please check');
    const resolved = () => cardOf(container, comment)?.hasAttribute('data-resolved');
    const others = () => cards.keys().filter((key) => key !== comment);

    reset();
    expect(editor.setCommentResolved(comment, true).ok).toBe(true);
    await settle();
    expect(resolved()).toBe(true);
    expect(cards.of(comment)).toBeGreaterThan(0);
    expect(others()).toEqual([]);

    reset();
    expect(editor.setCommentResolved(comment, false).ok).toBe(true);
    await settle();
    expect(resolved()).toBe(false);
    expect(cards.of(comment)).toBeGreaterThan(0);
    expect(others()).toEqual([]);

    reset();
    expect(editor.deleteReviewItem(comment).ok).toBe(true);
    await settle();
    expect(cardOf(container, comment)).toBeNull();
    expect(mountedCards(container)).toEqual(changes);
    expect(others()).toEqual([]);
  });

  test('an accepted change leaves, and an undo brings it back', async () => {
    const { container, editor, cards, reset } = await mountCountingRail();
    const mounted = mountedCards(container);
    const [first, ...rest] = mounted;
    expect(rest.length).toBeGreaterThan(0);

    reset();
    expect(editor.acceptReviewItem(first!).ok).toBe(true);
    await settle();
    expect(mountedCards(container)).toEqual(rest);
    for (const key of rest) expect(cards.of(key)).toBe(0);

    reset();
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    await settle();
    const back = mountedCards(container);
    expect(back).toHaveLength(mounted.length);
    expect(cardOf(container, back[0]!)?.textContent).toContain('added 0');
    expect(back.slice(1)).toEqual(rest);
    for (const key of rest) expect(cards.of(key)).toBe(0);
  });

  test('a reply draft and its focus stay while another card changes', async () => {
    const { container, editor, rail, reset } = await mountCountingRail();
    const changes = mountedCards(container);
    expect(changes.length).toBeGreaterThan(1);
    const comment = commentOn(editor, 0, 'please check');
    await settle();
    const wrapper = () => container.querySelector<HTMLElement>(`[data-card-key="${comment}"]`);
    const field = () =>
      cardOf(container, comment)?.querySelector<HTMLInputElement>(
        '[data-testid="review-reply-input"]'
      ) ?? null;

    // A new comment starts open. Closed, its card shows no reply box, and a click opens it.
    expect(editor.setActiveReviewItem(null, { reveal: false }).ok).toBe(true);
    await settle();
    expect(field()).toBeNull();
    cardOf(container, comment)!.click();
    await waitFor(() => field() !== null);
    const before = { wrapper: wrapper()!, card: cardOf(container, comment)!, field: field()! };
    before.field.focus();
    before.field.value = 'a draft';
    before.field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(document.activeElement).toBe(before.field);
    expect(container.querySelector('[data-testid="review-reply-cancel"]')).not.toBeNull();

    // Another card changes: a tracked change takes a reply, and the one after it is accepted.
    expect(editor.replyToReviewItem(changes[0]!, 'an answer', AUTHOR).ok).toBe(true);
    await settle();
    expect(editor.acceptReviewItem(changes[1]!).ok).toBe(true);
    await settle();
    expect(cardOf(container, changes[0]!)?.textContent).toContain('an answer');
    expect(cardOf(container, changes[1]!)).toBeNull();

    // The scroll crosses one band step, and the card with the draft stays in the band.
    reset();
    scrollTo(scrollerOf(container), RAIL_BAND_STEP + 20);
    await settle();
    expect(rail.total()).toBeGreaterThan(0);

    expect(wrapper()).toBe(before.wrapper);
    expect(cardOf(container, comment)).toBe(before.card);
    expect(field()).toBe(before.field);
    expect(field()!.value).toBe('a draft');
    expect(document.activeElement).toBe(before.field);
  });
});
