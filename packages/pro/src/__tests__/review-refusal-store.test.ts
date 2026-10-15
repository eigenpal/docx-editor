/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The per-editor store behind `useReview().lastRefusal` in both adapters.

import { expect, test } from 'bun:test';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { reviewRefusalStore } from '../review/review-refusal.ts';

function fakeEditor() {
  const state = { revision: 1, mode: 'editing', editable: true, collaboration: 'ready' };
  const listeners = new Map<string, Set<() => void>>();
  const editor = {
    getDocumentHandle: () => ({ revision: state.revision }),
    getEditingMode: () => state.mode,
    snapshot: () => ({
      editable: state.editable,
      collaborationStatus: state.collaboration,
      hiddenReviewAuthors: [],
    }),
    on: (event: string, listener: () => void) => {
      const set = listeners.get(event) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
  } as unknown as Editor;
  const emit = (event: string) => listeners.get(event)?.forEach((listener) => listener());
  const listenerCount = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return { editor, state, emit, listenerCount };
}

const REFUSED = {
  ok: false as const,
  code: 'unsupported' as const,
  reason: 'collaboration-session-not-ready',
};

test('one store per editor holds the refusal for every reader', () => {
  const { editor } = fakeEditor();
  expect(reviewRefusalStore(editor)).toBe(reviewRefusalStore(editor));
  expect(reviewRefusalStore(editor).record('accept', 'k1', REFUSED)).toBe(false);
  expect(reviewRefusalStore(editor).get()).toEqual({
    action: 'accept',
    key: 'k1',
    code: 'edit.collaboration-not-ready',
  });
  expect(reviewRefusalStore(editor).record('accept', 'k1', { ok: true, changed: true })).toBe(true);
  expect(reviewRefusalStore(editor).get()).toBeNull();
});

test('a change of state clears the refusal; a caret move does not', () => {
  const { editor, state, emit, listenerCount } = fakeEditor();
  const store = reviewRefusalStore(editor);
  let notified = 0;
  const off = store.subscribe(() => (notified += 1));
  // Idle: nothing held, so the store watches nothing on the editor.
  expect(listenerCount()).toBe(0);

  store.record('remove', 'k1', REFUSED);
  expect(notified).toBe(1);
  expect(listenerCount()).toBeGreaterThan(0);
  emit('selectionChange');
  expect(store.get()).not.toBeNull();

  state.collaboration = 'ready-again';
  emit('change');
  expect(store.get()).toBeNull();
  expect(notified).toBe(2);
  expect(listenerCount()).toBe(0);
  off();
});

test('every refusal moves the sequence, so a repeat is announced again', () => {
  const { editor } = fakeEditor();
  const store = reviewRefusalStore(editor);
  store.record('accept', 'k1', REFUSED);
  const first = store.sequence();
  store.record('accept', 'k1', REFUSED);
  expect(store.sequence()).toBe(first + 1);
});
