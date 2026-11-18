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
import { Profiler, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { reviewModule } from '../index.ts';
import { DocxEditorReview, type ReviewItemView } from '../react/index.ts';
import { RAIL_BAND_STEP } from '../review/rail-window.ts';
import { installRailGeometry } from './review-rail-metrics-harness.ts';
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
afterEach(cleanup);

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
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

async function mountRail(review: ReactNode) {
  let editor: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={pagedTrackedDocument()}
      modules={[reviewModule()]}
      onReady={(instance) => {
        editor = instance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        {review}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await waitFor(() => view.container.querySelector('[data-testid="review-card"]') !== null);
  await settle(60);
  return { container: view.container, editor: editor! };
}

/** A rail whose cards come from a render prop that counts its calls and the card's renders. */
function countingRail() {
  const templates = counter();
  const cards = counter();
  const commits = counter();
  const rail = (
    <Profiler id="rail" onRender={(id) => commits.add(id)}>
      <DocxEditorReview>
        {(item: ReviewItemView) => (
          <Profiler id={item.key} onRender={(id) => cards.add(id)}>
            {(templates.add(item.key), null)}
            <div data-card-key={item.key}>
              <DocxEditorReview.Card />
            </div>
          </Profiler>
        )}
      </DocxEditorReview>
    </Profiler>
  );
  const reset = () => {
    templates.reset();
    cards.reset();
    commits.reset();
  };
  return { rail, templates, cards, commits, reset };
}

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

  test('the packaged card renders no part for a keystroke that changes no item', async () => {
    // The packaged parts ask the host's resolver for their labels on each render, so its
    // calls count the renders of the parts. The rail element asks for its own name on each
    // of its renders; that one is not a card's.
    let labels: TranslationKey[] = [];
    const t = (key: TranslationKey): string | undefined => {
      if (key !== 'review.ariaLabel') labels.push(key);
      return undefined;
    };
    const { container, editor } = await mountRail(<DocxEditorReview t={t} />);
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
