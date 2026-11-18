/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How much the review rail renders for a scroll and for a keystroke. A scroll that mounts no
// new card renders no card, and a keystroke renders only the card of the item it changed. The
// rail once rendered every mounted card, with all its parts, on each scroll frame and each key.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { act, cleanup } from '@testing-library/react';
import type { ToolbarTranslate } from '@docx-editor.dev/react';
import { DocxEditorReview, useReviewItem, type ReviewItemView } from '../react/index.ts';
import { RAIL_BAND_STEP } from '../review/rail-window.ts';
import { insertBanner, installRailGeometry, railGeometry } from './review-rail-metrics-harness.ts';
import {
  INSIDE_INSERTION,
  PAGES,
  compactCardTop,
  counter,
  installViewHeight,
  mountedCards,
  scrollTo,
  scrollerOf,
  typeIn,
  unplaceItem,
} from './review-rail-render-work-harness.ts';
import {
  countingRail,
  mountRail,
  settle,
  waitFor,
} from './review-rail-render-work-react-harness.tsx';

let restore: (() => void)[] = [];
beforeAll(() => {
  restore = [installRailGeometry(), installViewHeight()];
});
afterAll(() => {
  for (const undo of restore) undo();
});
afterEach(() => {
  cleanup();
  railGeometry.clientWidth = 1400;
});

describe('review rail render work', () => {
  test('a scroll inside one band step renders nothing in the rail', async () => {
    const { rail, templates, cards, commits, reset } = countingRail();
    const { container } = await mountRail(rail);
    const before = mountedCards(container);
    expect(before.length).toBeGreaterThan(0);
    expect(before.length).toBeLessThan(PAGES);

    reset();
    const scroller = scrollerOf(container);
    for (const top of [20, 40, 60, 80]) {
      scrollTo(scroller, top);
      await settle();
    }
    expect(commits.total()).toBe(0);
    expect(templates.total()).toBe(0);
    expect(cards.total()).toBe(0);
    expect(mountedCards(container)).toEqual(before);
  });

  test('a scroll that mounts new cards renders only those cards', async () => {
    const { rail, templates, cards, reset } = countingRail();
    const { container } = await mountRail(rail);
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
    const { rail, templates, cards, reset } = countingRail();
    const { container, editor } = await mountRail(rail);
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);

    // Paragraph 0 is plain text: no item changes, so no card renders.
    reset();
    let changes = 0;
    await act(async () => {
      changes = typeIn(editor, 0);
    });
    await settle();
    expect(changes).toBeGreaterThan(0);
    expect(templates.total()).toBe(0);
    expect(cards.total()).toBe(0);

    // Inside the first tracked insertion: its card shows the new text, and no other renders.
    reset();
    await act(async () => {
      changes = typeIn(editor, 1, INSIDE_INSERTION);
    });
    await settle();
    expect(changes).toBeGreaterThan(0);
    expect(container.querySelector(`[data-card-key="${mounted[0]!}"]`)?.textContent).toContain(
      'adxded 0'
    );
    expect(templates.keys()).toEqual([mounted[0]!]);
    expect(cards.keys()).toEqual([mounted[0]!]);
  });

  test('a card that moves keeps its content without a render', async () => {
    const { rail, templates, cards, reset } = countingRail();
    const { container } = await mountRail(rail);
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
    const { rail, cards, reset } = countingRail();
    const { container, editor } = await mountRail(rail);
    const [first] = mountedCards(container);
    const card = () => container.querySelector(`[data-card-key="${first!}"]`)!;

    // From an author the rail already lists: a new author changes every card's colour slots.
    reset();
    await act(async () => {
      expect(editor.replyToReviewItem(first!, 'first answer', 'Ada Lovelace').ok).toBe(true);
    });
    await settle();
    expect(card().querySelector('[data-testid="review-reply"]')?.textContent).toContain(
      'first answer'
    );
    expect(cards.keys()).toEqual([first!]);

    // An edit of the reply reaches the card through the card's own replies.
    const reply = editor.getReviewItems().find((entry) => entry.text === 'first answer')!;
    reset();
    await act(async () => {
      expect(editor.setCommentText(reply.key, 'second answer').ok).toBe(true);
    });
    await settle();
    expect(card().querySelector('[data-testid="review-reply"]')?.textContent).toContain(
      'second answer'
    );
    expect(cards.keys()).toEqual([first!]);
  });

  test('a card template renders its parts only for the item that changed', async () => {
    let labels: string[] = [];
    const t = (key: string): string | undefined => {
      if (key !== 'review.ariaLabel') labels.push(key);
      return undefined;
    };
    const { container, editor } = await mountRail(
      <DocxEditorReview t={t as ToolbarTranslate}>
        <DocxEditorReview.List>
          <DocxEditorReview.Card className="host-card">
            <DocxEditorReview.Reply hidden />
            <span data-testid="host-extra" />
          </DocxEditorReview.Card>
        </DocxEditorReview.List>
      </DocxEditorReview>
    );
    const mounted = container.querySelectorAll('.host-card').length;
    expect(mounted).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-testid="host-extra"]')).toHaveLength(mounted);

    labels = [];
    await act(async () => {
      typeIn(editor, 0);
    });
    await settle();
    scrollTo(scrollerOf(container), 40);
    await settle();
    expect(labels).toEqual([]);

    // One card changes: each label is asked for once per render of that card, not per card.
    await act(async () => {
      typeIn(editor, 1, INSIDE_INSERTION);
    });
    await settle();
    expect(labels.length).toBeGreaterThan(0);
    const accepts = labels.filter((key) => key === 'review.accept').length;
    // One card, in the render that follows the key and at most one render after it.
    expect(accepts).toBeGreaterThan(0);
    expect(accepts).toBeLessThanOrEqual(2);
  });

  test('the compact card of an item without a placement follows each scroll position', async () => {
    // Too narrow for the column: the rail shows markers and floats the active item's card.
    railGeometry.clientWidth = 1000;
    const { container, editor } = await mountRail(<DocxEditorReview />, { ready: 'review-marker' });
    expect(
      container.querySelector('[data-testid="review-rail"]')?.hasAttribute('data-compact')
    ).toBe(true);
    const first = editor.getReviewItems()[0]!.key;
    const restoreRead = unplaceItem(editor, first);
    await act(async () => {
      expect(editor.setActiveReviewItem(first, { reveal: false }).ok).toBe(true);
    });
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

  test('another render prop renders each mounted card once', async () => {
    const calls = counter();
    const railWith = (label: string) => (
      <DocxEditorReview>
        {(item: ReviewItemView) => (
          <div data-card-key={item.key} data-label={label}>
            {(calls.add(item.key), null)}
            <DocxEditorReview.Card />
          </div>
        )}
      </DocxEditorReview>
    );
    const { container, rerender } = await mountRail(railWith('one'));
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);

    // The host renders again with state its render prop reads: every card shows it.
    calls.reset();
    await act(async () => rerender(railWith('two')));
    await settle();
    for (const key of mounted) expect(calls.of(key)).toBe(1);
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted.length);
  });

  test('another Card template renders each mounted card once', async () => {
    const renders = counter();
    function Probe({ label }: { label: string }) {
      const item = useReviewItem();
      renders.add(item!.key);
      return <span data-testid="host-extra" data-label={label} />;
    }
    const railWith = (label: string) => (
      <DocxEditorReview>
        <DocxEditorReview.List>
          <DocxEditorReview.Card className="host-card">
            <DocxEditorReview.Summary />
            <Probe label={label} />
          </DocxEditorReview.Card>
        </DocxEditorReview.List>
      </DocxEditorReview>
    );
    const { container, rerender } = await mountRail(railWith('one'));
    const mounted = container.querySelectorAll('.host-card').length;
    expect(mounted).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(mounted);

    const cards = renders.keys();
    expect(cards).toHaveLength(mounted);
    renders.reset();
    await act(async () => rerender(railWith('two')));
    await settle();
    for (const key of cards) expect(renders.of(key)).toBe(1);
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(0);
  });

  /** A rail whose render prop holds state of its own, and the errors React reports for it. */
  function statefulRail() {
    const errors: unknown[][] = [];
    const report = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    const rail = (
      <DocxEditorReview>
        {(item: ReviewItemView) => {
          const [presses, setPresses] = useState(0);
          return (
            <div data-card-key={item.key} data-presses={presses}>
              <button type="button" data-testid="press" onClick={() => setPresses(presses + 1)} />
              <DocxEditorReview.Card />
            </div>
          );
        }}
      </DocxEditorReview>
    );
    return {
      rail,
      errors,
      restoreConsole: () => {
        console.error = report;
      },
    };
  }

  test('a render prop that calls a hook keeps the state of each card', async () => {
    const { rail, errors, restoreConsole } = statefulRail();
    try {
      const { container, editor } = await mountRail(rail);
      const mounted = mountedCards(container);
      expect(mounted.length).toBeGreaterThan(1);
      const wrapper = (key: string) =>
        container.querySelector<HTMLElement>(`[data-card-key="${key}"]`)!;
      const press = async (key: string) =>
        act(async () => wrapper(key).querySelector<HTMLElement>('[data-testid="press"]')!.click());
      await press(mounted[0]!);
      await press(mounted[0]!);
      expect(wrapper(mounted[0]!).dataset.presses).toBe('2');
      expect(wrapper(mounted[1]!).dataset.presses).toBe('0');

      // The item changes and the render prop runs again: the card keeps its state.
      await act(async () => {
        typeIn(editor, 1, INSIDE_INSERTION);
      });
      await settle();
      expect(wrapper(mounted[0]!).textContent).toContain('adxded 0');
      expect(wrapper(mounted[0]!).dataset.presses).toBe('2');
      expect(errors).toEqual([]);
    } finally {
      restoreConsole();
    }
  });

  test('the compact card runs a render prop that calls a hook', async () => {
    railGeometry.clientWidth = 1000;
    const { rail, errors, restoreConsole } = statefulRail();
    try {
      const { container, editor } = await mountRail(rail, { ready: 'review-marker' });
      const [first, second] = editor.getReviewItems().map((entry) => entry.key);
      const floating = () =>
        container
          .querySelector('[data-testid="review-compact-card"]')
          ?.querySelector<HTMLElement>('[data-card-key]');
      const activate = async (key: string) => {
        await act(async () => {
          expect(editor.setActiveReviewItem(key, { reveal: false }).ok).toBe(true);
        });
        await waitFor(() => floating()?.dataset.cardKey === key);
        expect(floating()?.dataset.cardKey).toBe(key);
      };
      // The rail renders with and without the card: the hook is the card's, not the rail's.
      await activate(first!);
      await act(async () => {
        floating()!.querySelector<HTMLElement>('[data-testid="press"]')!.click();
      });
      expect(floating()?.dataset.presses).toBe('1');
      // Another item starts from its own state.
      await activate(second!);
      expect(floating()?.dataset.presses).toBe('0');
      await act(async () => {
        expect(editor.setActiveReviewItem(null).ok).toBe(true);
      });
      await waitFor(() => floating() === undefined);
      expect(floating()).toBeUndefined();
      expect(errors).toEqual([]);
    } finally {
      restoreConsole();
    }
  });

  test('a change of the rail settings renders every mounted card', async () => {
    const { rail, cards, reset } = countingRail();
    const { container, editor } = await mountRail(rail);
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);
    const accepts = () => [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="review-accept"]'),
    ];
    expect(accepts().some((button) => button.disabled)).toBe(false);

    // Viewing mode is not an item's data, but each card's actions follow it.
    reset();
    await act(async () => {
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    });
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
    const t = (key: string): string | undefined => {
      if (key !== 'review.ariaLabel') labels.push(key);
      return undefined;
    };
    const { container, editor } = await mountRail(<DocxEditorReview t={t as ToolbarTranslate} />);
    expect(labels).toContain('review.accept');

    labels = [];
    let changes = 0;
    await act(async () => {
      changes = typeIn(editor, 0);
    });
    await settle();
    expect(changes).toBeGreaterThan(0);
    scrollTo(scrollerOf(container), 40);
    await settle();
    expect(labels).toEqual([]);
  });
});
