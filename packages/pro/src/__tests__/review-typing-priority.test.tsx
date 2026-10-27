/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// When the review cards follow a change. Typing in one paragraph paints the document first and
// places the cards in a later render; every other change places them in the same render.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { useLayoutEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { useReviewOf } from '../react/useReview.ts';

afterEach(cleanup);

type Listener = (payload?: unknown) => void;

/** An editor whose queue holds `count` comments, and that emits what a test tells it to. */
function fakeEditor() {
  const listeners = new Map<string, Set<Listener>>();
  let revision = 0;
  let count = 0;
  const emit = (event: string, payload?: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const methods: Record<string, unknown> = {
    on: (event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
    getReviewRevision: () => revision,
    getEditingMode: () => 'editing',
    snapshot: () => ({ isLoading: false, hiddenReviewAuthors: [] }),
    getReviewItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: `c${index}`,
        isActive: false,
        item: { kind: 'comment', id: `c${index}` },
      })),
    addComment: () => {
      count += 1;
      revision += 1;
      emit('change', { revision, dirty: ['p1'] });
      return { ok: true };
    },
  };
  const editor = new Proxy(methods, {
    get: (target, name: string) => (name in target ? target[name] : () => null),
  }) as unknown as Editor;
  /** A change the engine reports, with one more card after it. */
  const change = (payload: Record<string, unknown>, selection = false) => {
    count += 1;
    revision += 1;
    emit('change', { revision, ...payload });
    if (selection) emit('selectionChange');
  };
  /** A click that changes what the queue reads, such as its active card; no paragraph changes. */
  const click = () => {
    count += 1;
    revision += 1;
    emit('selectionChange');
  };
  return { editor, change, click };
}

/** The card count of each commit while `act` runs `step`, and the hook's actions. */
function mount(editor: Editor) {
  const commits: number[] = [];
  let actions: ReturnType<typeof useReviewOf> | null = null;
  function Rail() {
    const review = useReviewOf(editor);
    actions = review;
    useLayoutEffect(() => {
      commits.push(review.items.length);
    });
    return null;
  }
  render(<Rail />);
  return {
    async after(step: () => void): Promise<number[]> {
      commits.length = 0;
      await act(async () => step());
      return [...commits];
    },
    actions: () => actions!,
  };
}

describe('the review cards after a change', () => {
  test('follow typing in one paragraph in a later render', async () => {
    const { editor, change } = fakeEditor();
    const rail = mount(editor);
    // The keystroke's own render keeps the cards it had; a later one places the new card.
    expect(await rail.after(() => change({ dirty: ['p1'] }, true))).toEqual([0, 1]);
  });

  test('follow a decision, a new paragraph and a load in the same render', async () => {
    const { editor, change } = fakeEditor();
    const rail = mount(editor);
    expect((await rail.after(() => change({ dirty: [] })))[0]).toBe(1);
    expect((await rail.after(() => change({ dirty: ['p1'], created: ['p2'] })))[0]).toBe(2);
    expect((await rail.after(() => change({ source: 'load' })))[0]).toBe(3);
  });

  test('follow a comment added from the hook in the same render', async () => {
    const { editor } = fakeEditor();
    const rail = mount(editor);
    expect((await rail.after(() => rail.actions().comment('note')))[0]).toBe(1);
  });

  test('follow a click after typing in the same render', async () => {
    const { editor, change, click } = fakeEditor();
    const rail = mount(editor);
    await rail.after(() => change({ dirty: ['p1'] }, true));
    // A click is not typing, even though the last change was.
    expect((await rail.after(click))[0]).toBe(2);
  });
});
