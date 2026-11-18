/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What the review rail does when its host renders again: with a render prop the host makes
// anew on each render, with another render prop, with another document, and after the host
// hid the rail. The Vue twin is `review-rail-host-renders-vue.test.ts`.
/* eslint-disable react-hooks/rules-of-hooks -- The rail runs a render prop as a component. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { useRef, useState } from 'react';
import { act, cleanup } from '@testing-library/react';
import { DocxEditorReview, type ReviewItemView } from '../react/index.ts';
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
  countingRail,
  mountRail,
  settle,
  waitFor,
} from './review-rail-render-work-react-harness.tsx';

const OTHER_AUTHOR = 'Grace Hopper';

let restore: (() => void)[] = [];
beforeAll(() => {
  restore = [installRailGeometry(), installViewHeight()];
});
afterAll(() => {
  for (const undo of restore) undo();
});
afterEach(() => {
  cleanup();
});

/** Collect what React reports through `console.error`. Answers the reports and the undo. */
function reactErrors() {
  const errors: unknown[][] = [];
  const report = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  return {
    errors,
    restoreConsole: () => {
      console.error = report;
    },
  };
}

describe('review rail and the renders of its host', () => {
  test('another render prop with other hooks mounts under another key', async () => {
    const counted = (item: ReviewItemView) => {
      const [presses, setPresses] = useState(0);
      return (
        <div data-card-key={item.key} data-template="counted" data-presses={presses}>
          <button type="button" data-testid="press" onClick={() => setPresses(presses + 1)} />
          <DocxEditorReview.Card />
        </div>
      );
    };
    const noted = (item: ReviewItemView) => {
      const renders = useRef(0);
      const [note] = useState('note');
      const [open] = useState(true);
      renders.current += 1;
      return (
        <div data-card-key={item.key} data-template="noted" data-note={note} data-open={open}>
          <DocxEditorReview.Card />
        </div>
      );
    };
    const { errors, restoreConsole } = reactErrors();
    try {
      const { container, rerender } = await mountRail(
        <DocxEditorReview key="counted">{counted}</DocxEditorReview>
      );
      const mounted = mountedCards(container);
      expect(mounted.length).toBeGreaterThan(1);
      await act(async () => {
        container.querySelector<HTMLElement>('[data-testid="press"]')!.click();
      });
      expect(container.querySelectorAll('[data-presses="1"]')).toHaveLength(1);

      await act(async () => rerender(<DocxEditorReview key="noted">{noted}</DocxEditorReview>));
      await settle();
      expect(mountedCards(container)).toEqual(mounted);
      expect(container.querySelectorAll('[data-template="noted"]')).toHaveLength(mounted.length);
      expect(container.querySelectorAll('[data-template="counted"]')).toHaveLength(0);

      // Back to the first one: its cards start from new state.
      await act(async () => rerender(<DocxEditorReview key="counted">{counted}</DocxEditorReview>));
      await settle();
      expect(container.querySelectorAll('[data-presses="0"]')).toHaveLength(mounted.length);
      expect(errors).toEqual([]);
    } finally {
      restoreConsole();
    }
  });

  test('an inline render prop runs once per card on each render of the host', async () => {
    const calls = counter();
    let renderHost: (ticks: number) => void = () => {};
    function Host() {
      const [ticks, setTicks] = useState(0);
      renderHost = setTicks;
      return (
        <DocxEditorReview>
          {(item: ReviewItemView) => {
            // The function is new on each render of the host. Its hooks stay the card's.
            const [presses, setPresses] = useState(0);
            calls.add(item.key);
            return (
              <div data-card-key={item.key} data-ticks={ticks} data-presses={presses}>
                <button type="button" data-testid="press" onClick={() => setPresses(presses + 1)} />
                <DocxEditorReview.Card />
              </div>
            );
          }}
        </DocxEditorReview>
      );
    }
    const { errors, restoreConsole } = reactErrors();
    try {
      const { container } = await mountRail(<Host />);
      const mounted = mountedCards(container);
      expect(mounted.length).toBeGreaterThan(1);
      const first = container.querySelector<HTMLElement>(`[data-card-key="${mounted[0]!}"]`)!;
      await act(async () => first.querySelector<HTMLElement>('[data-testid="press"]')!.click());
      expect(first.dataset.presses).toBe('1');

      // The cost of an inline render prop: every mounted card renders for each host render.
      for (let ticks = 1; ticks <= 5; ticks += 1) {
        calls.reset();
        await act(async () => renderHost(ticks));
        for (const key of mounted) expect(calls.of(key)).toBe(1);
        expect(container.querySelectorAll(`[data-ticks="${ticks}"]`)).toHaveLength(mounted.length);
      }
      // The cards rendered. They did not mount again: the element and its state are the same.
      expect(container.querySelector(`[data-card-key="${mounted[0]!}"]`)).toBe(first);
      expect(first.dataset.presses).toBe('1');
      expect(errors).toEqual([]);
    } finally {
      restoreConsole();
    }
  });

  test('a new document loaded into the same editor shows only the cards of that document', async () => {
    const { rail, templates, reset } = countingRail();
    const { container, editor } = await mountRail(rail);
    const before = mountedCards(container);
    expect(before.length).toBeGreaterThan(1);
    expect(authorsOf(container)).toEqual([AUTHOR]);

    reset();
    await act(async () => {
      editor.load(pagedTrackedDocument(() => OTHER_AUTHOR));
    });
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
    const { rail, railWith } = countingRail();
    const { container, editor, rerender } = await mountRail(rail);
    const [first, second] = mountedCards(container);
    expect(second).toBeDefined();

    await act(async () => rerender(railWith({ hidden: true })));
    await settle();
    expect(container.querySelector('[data-testid="review-rail"]')).toBeNull();
    expect(mountedCards(container)).toEqual([]);

    // While the rail is hidden: one change gets new text and a reply, and another leaves.
    await act(async () => {
      typeIn(editor, 1, INSIDE_INSERTION);
      expect(editor.replyToReviewItem(first!, 'said while hidden', AUTHOR).ok).toBe(true);
      expect(editor.acceptReviewItem(second!).ok).toBe(true);
    });
    await settle();

    await act(async () => rerender(railWith({})));
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
