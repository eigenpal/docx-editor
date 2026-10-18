/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import { adoptReviewItems, type ReviewAdoptOptions } from '../review/review-item-author.ts';
import { stackReviewPositions } from '../review/rail-stack.ts';
import {
  reviewAuthorFilterKey,
  reviewRefusalStore,
  type ReviewWriteAction,
  type ReviewWriteRefusal,
} from '../review/review-refusal.ts';
import type {
  Editor,
  ReviewActivationOptions,
  ReviewItemPlacement,
  ScrollPlacement,
  ReviewItemQuery,
  ReviewItemRevealEvent,
  ReviewItemRevealSource,
} from '@docx-editor.dev/core/contracts/editor';
import type { ExecResult } from '@docx-editor.dev/core/contracts/types';
import { useDocxEditor, type MaybeRefOrGetter } from '@docx-editor.dev/vue';
import { useEditorRenderRevision, type EditorRenderRevision } from './useEditorRenderRevision.ts';
import { nextTask } from './next-task.ts';

function unwrapMaybeRefOrGetter<T>(source: MaybeRefOrGetter<T> | undefined): T | undefined {
  if (source === undefined) return undefined;
  if (typeof source === 'function') return (source as () => T)();
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return (source as unknown as Ref<T>).value;
  }
  return source as T;
}

function reviewRevisionKey(editor: Editor): string {
  return `${editor.getReviewRevision()}:${editor.getEditingMode()}:${reviewAuthorFilterKey(editor)}`;
}

/** @public */
export type ReviewItemView = ReviewItemPlacement;

/** @public */
export type {
  ReviewActivationOptions,
  ReviewAdoptOptions,
  ReviewItemRevealEvent,
  ReviewItemRevealSource,
  ScrollPlacement,
};

/** @public */
export interface UseReviewReturn {
  readonly items: ComputedRef<readonly ReviewItemView[]>;
  /** The CARET-ACTIVE item: the one the caret is in, or null. */
  readonly activeKey: ComputedRef<string | null>;
  /**
   * The key of the ACTIVATED item: the one `setActive`, Next Change, or Previous Change
   * made active, while the caret stays in it. `null` when only a caret move made an item
   * active. `activeKey` is the caret-active item instead: the one the caret is in,
   * however it got there. The key follows this hook's query, so a paired replacement reports
   * the pair's key under `pairReplacements: true`. The same value as the editor's
   * `getActivatedReviewItemKey(query)`, read on every selection change.
   */
  readonly activatedKey: ComputedRef<string | null>;
  /**
   * Card to document: puts the caret at the start of the item and scrolls to it. Reports
   * whether it landed.
   *
   * With `{ announce: true }`, a call that lands fires the editor's `reviewItemReveal` event
   * with `source: 'host'`, also when the item was already active. The packaged review UI then
   * opens the item's balloon, or opens a closed pane at its card when the pane's `opening`
   * setting is `'auto'`. Without it, the call fires no event. A `null` key closes the card.
   *
   * @example
   * ```ts
   * const { setActive } = useReview();
   * useEditorEvent('reviewItemReveal', ({ key, source }) => openMyCard(key, source));
   * setActive(key); // fires nothing
   * setActive(key, { announce: true }); // fires 'reviewItemReveal'
   * setActive(key, { reveal: false }); // opens the item without scrolling
   * ```
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling | Accept or reject without scrolling}
   */
  readonly setActive: (key: string | null, options?: ReviewActivationOptions) => boolean;
  /**
   * Accept a revision. Reports whether it landed. For headless or server use, see
   * `Revision.accept()` in `@docx-editor.dev/editor-api`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling | Accept or reject without scrolling}
   */
  readonly accept: (item: ReviewItemView) => boolean;
  /**
   * Reject a revision. Reports whether it landed. For headless or server use, see
   * `Revision.reject()` in `@docx-editor.dev/editor-api`.
   */
  readonly reject: (item: ReviewItemView) => boolean;
  /**
   * Adopt tracked changes as the reviewer's own; they stay pending. Takes one item or a list,
   * and ignores comment items. The default author is `DocxEditorConfig.author`. One undo
   * step. Reports whether it landed: false when no revision was passed, when no author is
   * known, or when the editor refuses the write.
   */
  readonly adopt: (
    items: ReviewItemView | readonly ReviewItemView[],
    options?: ReviewAdoptOptions
  ) => boolean;
  readonly resolve: (item: ReviewItemView) => boolean;
  readonly reopen: (item: ReviewItemView) => boolean;
  readonly commentResolutionDisabledReason: ComputedRef<string | null>;
  readonly remove: (item: ReviewItemView) => boolean;
  /**
   * Reply to a comment or a revision. The author is `DocxEditorConfig.author` unless you pass
   * one. Reports whether the reply landed. For headless or server use, see `Comment.reply` in
   * `@docx-editor.dev/editor-api`.
   */
  readonly reply: (item: ReviewItemView, text: string, author?: string) => boolean;
  /** Where a comment on the current selection would sit, in layout points, or null. */
  readonly selectionAnchorY: ComputedRef<number | null>;
  /**
   * Comment on the current selection. Reports whether it landed, like `reply`. To comment
   * on found text, select it first with `editor.findMatches` and `editor.selectMatch`. For
   * headless or server use, see `Range.insertComment` in `@docx-editor.dev/editor-api`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text | Comment on found text}
   */
  readonly comment: (text: string, author?: string) => boolean;
  /**
   * Why the last accept, reject, resolve, reopen, remove, reply or comment did not land, or null.
   *
   * Shared by every `useReview()` over the same editor, so a custom card sees a refusal the
   * packaged rail recorded. Cleared by the next write that lands and by a change to the
   * document, the editing mode, editability, the collaboration status or the author filter; a
   * caret move keeps it. The packaged cards show it as a sentence; a custom card reads `key` to
   * place it and `code`, the public diagnostic code, to word it.
   */
  readonly lastRefusal: ComputedRef<ReviewWriteRefusal | null>;
  readonly paneOpen: ComputedRef<boolean>;
  readonly setPaneOpen: (open: boolean) => void;
  readonly ready: ComputedRef<boolean>;
}

/** @public */
export function useReview(query?: MaybeRefOrGetter<ReviewItemQuery | undefined>): UseReviewReturn {
  const editorRef = useDocxEditor();
  const renderRevision = useEditorRenderRevision();
  return useReviewOfInternal(editorRef as unknown as Ref<Editor | null>, query, renderRevision);
}

/** @internal */
export function useReviewWithRevision(
  query: MaybeRefOrGetter<ReviewItemQuery | undefined> | undefined,
  renderRevision: EditorRenderRevision
): UseReviewReturn {
  const editorRef = useDocxEditor();
  return useReviewOfInternal(editorRef as unknown as Ref<Editor | null>, query, renderRevision);
}

/** @public */
export function useReviewOf(
  editorRef: Ref<Editor | null>,
  query?: MaybeRefOrGetter<ReviewItemQuery | undefined>
): UseReviewReturn {
  return useReviewOfInternal(editorRef, query);
}

function useReviewOfInternal(
  editorRef: Ref<Editor | null>,
  query?: MaybeRefOrGetter<ReviewItemQuery | undefined>,
  renderRevision?: EditorRenderRevision
): UseReviewReturn {
  const ownedRevision = renderRevision ? null : shallowRef<unknown>('none');
  const touch = () => {
    void (renderRevision ?? ownedRevision)?.value;
  };

  // The explicitly activated key is read on every selection change, not on the deferred
  // review tick: a balloon decides in the same flush whether the item was opened on purpose.
  const activatedKeyRef = shallowRef<string | null>(null);
  const readActivatedKey = (editor: Editor | null): void => {
    activatedKeyRef.value =
      editor?.getActivatedReviewItemKey(unwrapMaybeRefOrGetter(query)) ?? null;
  };

  if (!renderRevision) {
    watch(
      () => editorRef.value,
      (editor, _prev, onCleanup) => {
        readActivatedKey(editor);
        if (!editor) {
          ownedRevision!.value = 'none';
          return;
        }
        let key = reviewRevisionKey(editor);
        ownedRevision!.value = key;
        let disposed = false;
        // A message task, not a timer: see `next-task.ts`.
        let scheduled = false;
        const notify = () => {
          if (!disposed) readActivatedKey(editor);
          if (disposed || scheduled) return;
          scheduled = true;
          nextTask(() => {
            scheduled = false;
            if (disposed) return;
            const next = reviewRevisionKey(editor);
            if (next === key) return;
            key = next;
            ownedRevision!.value = next;
          });
        };
        const offDocument = editor.on('change', notify);
        const offSelection = editor.on('selectionChange', notify);
        const offError = editor.on('error', notify);
        onCleanup(() => {
          disposed = true;
          offDocument();
          offSelection();
          offError();
        });
      },
      { immediate: true, flush: 'sync' }
    );
  }

  if (renderRevision) {
    watch(
      () => editorRef.value,
      (editor, _previous, onCleanup) => {
        readActivatedKey(editor);
        if (!editor) return;
        const read = (): void => readActivatedKey(editor);
        const offSelection = editor.on('selectionChange', read);
        const offChange = editor.on('change', read);
        onCleanup(() => {
          offSelection();
          offChange();
        });
      },
      { immediate: true, flush: 'sync' }
    );
  }

  const items = computed((): readonly ReviewItemView[] => {
    touch();
    const editor = editorRef.value;
    const q = unwrapMaybeRefOrGetter(query);
    if (!editor) return [];
    return editor
      .getReviewItems(q)
      .filter((entry) => entry.item.kind !== 'custom' || entry.item.carded);
  });

  const activeKey = computed(() => items.value.find((entry) => entry.isActive)?.key ?? null);
  const activatedKey = computed(() => activatedKeyRef.value);

  const setActive = (key: string | null, options?: ReviewActivationOptions): boolean => {
    const editor = editorRef.value;
    if (!editor) return false;
    return editor.setActiveReviewItem(key, options).ok;
  };

  // One store per EDITOR, so every hook over it, the packaged rail's included, sees the same
  // refusal. The store clears it once the state it was refused in changes.
  const refusalRef = shallowRef<ReviewWriteRefusal | null>(null);
  watch(
    () => editorRef.value,
    (editor, _previous, onCleanup) => {
      if (!editor) {
        refusalRef.value = null;
        return;
      }
      const store = reviewRefusalStore(editor);
      refusalRef.value = store.get();
      onCleanup(store.subscribe(() => (refusalRef.value = store.get())));
    },
    { immediate: true, flush: 'sync' }
  );
  const settle = (action: ReviewWriteAction, key: string | null, result: ExecResult): boolean => {
    const editor = editorRef.value;
    if (editor) reviewRefusalStore(editor).record(action, key, result);
    return result.ok;
  };
  const lastRefusal = computed((): ReviewWriteRefusal | null => refusalRef.value);

  const accept = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor || item.kind !== 'revision' || item.readOnly) return false;
    return settle('accept', item.key, editor.acceptReviewItem(item.key));
  };

  const reject = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor || item.kind !== 'revision' || item.readOnly) return false;
    return settle('reject', item.key, editor.rejectReviewItem(item.key));
  };

  const adopt = (
    items: ReviewItemView | readonly ReviewItemView[],
    options?: ReviewAdoptOptions
  ): boolean => adoptReviewItems(editorRef.value, items, options);

  const resolve = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor || item.kind !== 'comment') return false;
    return settle('resolve', item.key, editor.setCommentResolved(item.key, true));
  };

  const reopen = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor || item.kind !== 'comment') return false;
    return settle('reopen', item.key, editor.setCommentResolved(item.key, false));
  };

  const commentResolutionDisabledReason = computed((): string | null => {
    touch();
    return editorRef.value?.getEditingMode() === 'viewing'
      ? 'the document is open for viewing'
      : null;
  });

  const remove = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor) return false;
    if (item.kind === 'custom') return false;
    if (item.kind === 'revision' && item.readOnly) return false;
    return settle('remove', item.key, editor.deleteReviewItem(item.key));
  };

  const reply = (item: ReviewItemView, text: string, author?: string): boolean => {
    if (text.trim().length === 0 || !editorRef.value) return false;
    return settle('reply', item.key, editorRef.value.replyToReviewItem(item.key, text, author));
  };

  const selectionAnchorY = computed((): number | null => {
    touch();
    const editor = editorRef.value;
    if (!editor) return null;
    return editor.getSelectionPlacement()?.anchorY ?? null;
  });

  const comment = (text: string, author?: string): boolean => {
    if (text.trim().length === 0 || !editorRef.value) return false;
    return settle('comment', null, editorRef.value.addComment(text, author));
  };

  const paneOpen = computed((): boolean => {
    touch();
    const editor = editorRef.value;
    if (!editor) return true;
    return editor.isReviewPaneOpen();
  });

  const setPaneOpen = (next: boolean): void => {
    const editor = editorRef.value;
    if (!editor || editor.isReviewPaneOpen() === next) return;
    editor.exec({ type: 'toggleReviewPane' });
  };

  const ready = computed((): boolean => {
    touch();
    const editor = editorRef.value;
    if (editor === null) return false;
    const snapshot = editor.snapshot();
    return !snapshot.isLoading && snapshot.parseError === null;
  });

  return {
    items,
    activeKey,
    activatedKey,
    setActive,
    accept,
    reject,
    adopt,
    resolve,
    reopen,
    commentResolutionDisabledReason,
    remove,
    reply,
    selectionAnchorY,
    comment,
    lastRefusal,
    paneOpen,
    setPaneOpen,
    ready,
  };
}

/**
 * Non-overlapping Y positions for cards you have measured.
 *
 * Pass entries in document order, each with a key and an anchor, and the measured card heights.
 * An entry with `isActive: true` stays at its own anchor, and the entries before it move up.
 * Anchors are in layout points. Measured heights are in CSS pixels, so pass `scale` to add them.
 *
 * Returns each card's top in layout points. `useReviewRailMetrics` supplies `scale` and the
 * pixel offset of the first page: a card's CSS `top` is `metrics.top + position * metrics.scale`.
 *
 * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards | Custom cards in the review rail}
 * @public
 */
export function useStackedReviewPositions(
  items: MaybeRefOrGetter<
    readonly {
      readonly key: string;
      readonly anchorY: number | null;
      /** Keep this entry at its own anchor; the entries before it move up. */
      readonly isActive?: boolean;
    }[]
  >,
  heights: MaybeRefOrGetter<ReadonlyMap<string, number>>,
  options: MaybeRefOrGetter<{
    readonly gap?: number;
    readonly scale?: number;
    readonly defaultHeight?: number;
  }> = {}
): ComputedRef<ReadonlyMap<string, number>> {
  return computed(() => {
    const entries = unwrapMaybeRefOrGetter(items) ?? [];
    const heightMap = unwrapMaybeRefOrGetter(heights) ?? new Map<string, number>();
    const opts = unwrapMaybeRefOrGetter(options) ?? {};
    const gap = opts.gap ?? 8;
    const scale = opts.scale ?? 1;
    const defaultHeight = opts.defaultHeight ?? 0;
    return stackReviewPositions(entries, heightMap, { gap, scale, defaultHeight });
  });
}
