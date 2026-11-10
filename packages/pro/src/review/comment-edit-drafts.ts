/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

export interface CommentEditDraft {
  readonly text: string;
  readonly original: string;
  readonly refused: boolean;
}

/** Drafts survive review-card virtualization and close only on Save, Cancel, or document load. */
export function commentEditDrafts(editor: Editor) {
  let store = stores.get(editor);
  if (store) return store;
  const drafts = new Map<string, CommentEditDraft>();
  const focusRequests = new Set<string>();
  const allListeners = new Set<() => void>();
  let snapshot: readonly (readonly [string, CommentEditDraft])[] = [];
  const listeners = new Map<string, Set<() => void>>();
  store = {
    requestFocus: (key: string) => {
      focusRequests.add(key);
    },
    takeFocus: (key: string) => focusRequests.delete(key),
    all: () => snapshot,
    subscribeAll(notify: () => void) {
      allListeners.add(notify);
      return () => {
        allListeners.delete(notify);
      };
    },
    get: (key: string) => drafts.get(key) ?? null,
    set(key: string, draft: CommentEditDraft | null) {
      if (draft) drafts.set(key, draft);
      else drafts.delete(key);
      snapshot = Array.from(drafts);
      for (const notify of listeners.get(key) ?? []) notify();
      for (const notify of allListeners) notify();
    },
    subscribe(key: string, notify: () => void) {
      const group = listeners.get(key) ?? new Set();
      listeners.set(key, group);
      group.add(notify);
      return () => {
        group.delete(notify);
        if (group.size === 0) listeners.delete(key);
      };
    },
  };
  editor.on('change', (change) => {
    if (change.source !== 'load') return;
    drafts.clear();
    focusRequests.clear();
    snapshot = [];
    for (const notify of allListeners) notify();
    for (const group of listeners.values()) for (const notify of group) notify();
  });
  stores.set(editor, store);
  return store;
}
type DraftStore = {
  requestFocus(key: string): void;
  takeFocus(key: string): boolean;
  all(): readonly (readonly [string, CommentEditDraft])[];
  subscribeAll(notify: () => void): () => void;
  get(key: string): CommentEditDraft | null;
  set(key: string, draft: CommentEditDraft | null): void;
  subscribe(key: string, notify: () => void): () => void;
};
const stores = new WeakMap<Editor, DraftStore>();
