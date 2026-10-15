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
  const store = reviewRefusalStore(editor);
  expect(reviewRefusalStore(editor)).toBe(store);
  store.record('accept', 'k1', REFUSED);
  expect(store.get()).toEqual({
    action: 'accept',
    key: 'k1',
    code: 'edit.collaboration-not-ready',
    sequence: 1,
  });
  store.record('accept', 'k1', { ok: true, changed: true });
  expect(store.get()).toBeNull();
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
  const first = store.get()!.sequence;
  store.record('accept', 'k1', REFUSED);
  expect(store.get()!.sequence).toBe(first + 1);
});

test('a refusal held while nobody listened is rechecked after subscribe', async () => {
  const { editor, state } = fakeEditor();
  const store = reviewRefusalStore(editor);
  store.record('accept', 'k1', REFUSED);
  state.mode = 'viewing';
  let notified = 0;
  const off = store.subscribe(() => (notified += 1));
  // Never from inside the subscribe call itself.
  expect(notified).toBe(0);
  await Promise.resolve();
  expect(store.get()).toBeNull();
  expect(notified).toBe(1);
  off();
});

test('a session moving between not-ready states keeps the refusal', () => {
  const { editor, state, emit } = fakeEditor();
  state.collaboration = 'initializing';
  const store = reviewRefusalStore(editor);
  const off = store.subscribe(() => undefined);
  store.record('accept', 'k1', REFUSED);
  state.collaboration = 'disconnected';
  emit('change');
  expect(store.get()).not.toBeNull();
  state.collaboration = 'ready';
  emit('change');
  expect(store.get()).toBeNull();
  off();
});
