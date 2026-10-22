/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The per-editor store behind `useReview().lastRefusal` in both adapters.

import { expect, test } from 'bun:test';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import {
  reviewRefusalLabelKey,
  reviewRefusalMessage,
  reviewRefusalStore,
  reviewWriteRefusalOf,
} from '../review/review-refusal.ts';

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
  const emit = (event: string, payload?: unknown) =>
    listeners.get(event)?.forEach((listener) => (listener as (value: unknown) => void)(payload));
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
    final: false,
  });
  store.record('accept', 'k1', { ok: true, changed: true });
  expect(store.get()).toBeNull();
});

test('a change of state clears the refusal; a caret move does not', () => {
  const { editor, state, emit, listenerCount } = fakeEditor();
  const store = reviewRefusalStore(editor);
  let notified = 0;
  const off = store.subscribe(() => (notified += 1));
  // Idle: nothing held, so the store watches only for an accept-all that leaves changes.
  expect(listenerCount()).toBe(1);

  store.record('remove', 'k1', REFUSED);
  expect(notified).toBe(1);
  expect(listenerCount()).toBeGreaterThan(0);
  emit('selectionChange');
  expect(store.get()).not.toBeNull();

  state.collaboration = 'ready-again';
  emit('change');
  expect(store.get()).toBeNull();
  expect(notified).toBe(2);
  expect(listenerCount()).toBe(1);
  off();
  expect(listenerCount()).toBe(0);
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

test('any collaboration status change is a point to retry at', () => {
  const { editor, state, emit } = fakeEditor();
  state.collaboration = 'initializing';
  const store = reviewRefusalStore(editor);
  const off = store.subscribe(() => undefined);
  store.record('accept', 'k1', REFUSED);
  state.collaboration = 'disconnected';
  emit('change');
  expect(store.get()).toBeNull();
  off();
});

test('a refusal from an ended session is final', () => {
  const { editor } = fakeEditor();
  const store = reviewRefusalStore(editor);
  store.record('accept', 'k1', { ...REFUSED, reason: 'collaboration-session-destroyed' });
  expect(store.get()).toMatchObject({ code: 'edit.collaboration-not-ready', final: true });
  store.record('accept', 'k1', REFUSED);
  expect(store.get()!.final).toBe(false);
});

test('a tracked change the engine could not decide names its review code and sentence', () => {
  for (const [reason, code, label] of [
    [
      'retained-structure: the row stays',
      'review.retained-structure',
      'review.refusedRetainedStructure',
    ],
    [
      'incomplete-group: each change would also resolve',
      'review.incomplete-group',
      'review.refusedIncompleteGroup',
    ],
    [
      'locked-content: the change stays pending',
      'review.locked-content',
      'review.refusedLockedContent',
    ],
    [
      'bound-content: the change stays pending',
      'review.bound-content',
      'review.refusedBoundContent',
    ],
    ['unsupported-revision: read-only', 'review.revision-unsupported', 'review.refusedUnsupported'],
    ['unknown-revision', 'review.stale-revision', 'review.refusedStale'],
  ] as const) {
    const refusal = reviewWriteRefusalOf(
      'accept',
      'k',
      { ok: false, code: 'unsupported', reason },
      1
    );
    expect(refusal?.code).toBe(code);
    expect(reviewRefusalLabelKey(refusal?.code, 'review.actionRefused')).toBe(label);
  }
});

test('an accept-all that leaves a change pending holds the reason on that change', () => {
  const { editor, emit } = fakeEditor();
  const store = reviewRefusalStore(editor);
  const off = store.subscribe(() => {});
  emit('reviewChangesResolved', {
    action: 'reject',
    resolvedCount: 1,
    skipped: [{ key: 'row', reason: 'retained-structure' }],
  });
  expect(store.get()).toMatchObject({
    action: 'reject',
    key: 'row',
    code: 'review.retained-structure',
  });
  emit('reviewChangesResolved', { action: 'accept', resolvedCount: 2, skipped: [] });
  expect(store.get()).toBeNull();
  // A skipped half of a replacement names the pair's card, which the pane lists.
  emit('reviewChangesResolved', {
    action: 'accept',
    resolvedCount: 0,
    skipped: [{ key: 'half', pairKey: 'pair', reason: 'incomplete-group' }],
  });
  expect(store.get()).toMatchObject({ key: 'pair', code: 'review.incomplete-group' });
  // A lock or a binding names its own code and sentence, as a card decision on it does.
  for (const [detail, code] of [
    ['locked-content', 'review.locked-content'],
    ['bound-content', 'review.bound-content'],
  ] as const) {
    emit('reviewChangesResolved', {
      action: 'accept',
      resolvedCount: 0,
      skipped: [{ key: 'kept', reason: 'unsupported-revision', detail }],
    });
    expect(store.get()).toMatchObject({ key: 'kept', code });
  }
  off();
});

test('the packaged sentence for a refusal reads its cause, or the action sentence', () => {
  const t = (key: string) => `<${key}>`;
  const retained = reviewWriteRefusalOf(
    'reject',
    'row',
    { ok: false, code: 'unsupported', reason: 'retained-structure: the row stays' },
    1
  )!;
  expect(reviewRefusalMessage(retained, t)).toBe('<review.refusedRetainedStructure>');
  const other = reviewWriteRefusalOf('reply', 'c', REFUSED, 2)!;
  expect(reviewRefusalMessage({ ...other, code: 'edit.refused' }, t)).toBe('<review.replyRefused>');
});

test('a stale card names the stale code; a reply never names a review code', () => {
  const stale = {
    ok: false as const,
    code: 'notFound' as const,
    reason: 'unknown-revision: no revision with that key',
  };
  expect(reviewWriteRefusalOf('accept', 'k', stale, 1)?.code).toBe('review.stale-revision');
  expect(reviewWriteRefusalOf('reply', 'c', stale, 2)?.code).not.toMatch(/^review\./);
});
