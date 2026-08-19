/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import type {
  ReviewActivationOptions,
  ReviewItemPlacement,
  ReviewItemQuery,
} from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { useDocxEditor, type MaybeRefOrGetter } from '@docx-editor.dev/vue';
import { useEditorRenderRevision, type EditorRenderRevision } from './useEditorRenderRevision.ts';

function unwrapMaybeRefOrGetter<T>(source: MaybeRefOrGetter<T> | undefined): T | undefined {
  if (source === undefined) return undefined;
  if (typeof source === 'function') return (source as () => T)();
  if (typeof source === 'object' && source !== null && 'value' in source) {
    return (source as unknown as Ref<T>).value;
  }
  return source as T;
}

function reviewRevisionKey(editor: DocxEditorInstance): string {
  return `${editor.getReviewRevision()}:${editor.getEditingMode()}`;
}

/** @public */
export type ReviewItemView = ReviewItemPlacement;

/** @public */
export type { ReviewActivationOptions };

/** @public */
export interface UseReviewReturn {
  readonly items: ComputedRef<readonly ReviewItemView[]>;
  readonly activeKey: ComputedRef<string | null>;
  readonly setActive: (key: string | null, options?: ReviewActivationOptions) => boolean;
  readonly accept: (item: ReviewItemView) => boolean;
  readonly reject: (item: ReviewItemView) => boolean;
  readonly resolve: (item: ReviewItemView) => boolean;
  readonly reopen: (item: ReviewItemView) => boolean;
  readonly commentResolutionDisabledReason: ComputedRef<string | null>;
  readonly remove: (item: ReviewItemView) => boolean;
  readonly reply: (item: ReviewItemView, text: string, author?: string) => boolean;
  readonly selectionAnchorY: ComputedRef<number | null>;
  readonly comment: (text: string, author?: string) => boolean;
  readonly paneOpen: ComputedRef<boolean>;
  readonly setPaneOpen: (open: boolean) => void;
  readonly ready: ComputedRef<boolean>;
}

/** @public */
export function useReview(query?: MaybeRefOrGetter<ReviewItemQuery | undefined>): UseReviewReturn {
  const editorRef = useDocxEditor();
  const renderRevision = useEditorRenderRevision();
  return useReviewOfInternal(
    editorRef as unknown as Ref<DocxEditorInstance | null>,
    query,
    renderRevision
  );
}

/** @internal */
export function useReviewWithRevision(
  query: MaybeRefOrGetter<ReviewItemQuery | undefined> | undefined,
  renderRevision: EditorRenderRevision
): UseReviewReturn {
  const editorRef = useDocxEditor();
  return useReviewOfInternal(
    editorRef as unknown as Ref<DocxEditorInstance | null>,
    query,
    renderRevision
  );
}

/** @public */
export function useReviewOf(
  editorRef: Ref<DocxEditorInstance | null>,
  query?: MaybeRefOrGetter<ReviewItemQuery | undefined>
): UseReviewReturn {
  return useReviewOfInternal(editorRef, query);
}

function useReviewOfInternal(
  editorRef: Ref<DocxEditorInstance | null>,
  query?: MaybeRefOrGetter<ReviewItemQuery | undefined>,
  renderRevision?: EditorRenderRevision
): UseReviewReturn {
  const ownedRevision = renderRevision ? null : shallowRef<unknown>('none');
  const touch = () => {
    void (renderRevision ?? ownedRevision)?.value;
  };

  if (!renderRevision) {
    watch(
      () => editorRef.value,
      (editor, _prev, onCleanup) => {
        if (!editor) {
          ownedRevision!.value = 'none';
          return;
        }
        let key = reviewRevisionKey(editor);
        ownedRevision!.value = key;
        let disposed = false;
        let scheduled: ReturnType<typeof setTimeout> | null = null;
        const notify = () => {
          if (disposed || scheduled !== null) return;
          scheduled = setTimeout(() => {
            scheduled = null;
            if (disposed) return;
            const next = reviewRevisionKey(editor);
            if (next === key) return;
            key = next;
            ownedRevision!.value = next;
          }, 0);
        };
        const offDocument = editor.on('change', notify);
        const offSelection = editor.on('selectionChange', notify);
        const offError = editor.on('error', notify);
        onCleanup(() => {
          disposed = true;
          if (scheduled !== null) clearTimeout(scheduled);
          offDocument();
          offSelection();
          offError();
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

  const setActive = (key: string | null, options?: ReviewActivationOptions): boolean => {
    const editor = editorRef.value;
    if (!editor) return false;
    return editor.setActiveReviewItem(key, options).ok;
  };

  const accept = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor || item.kind !== 'revision' || item.readOnly) return false;
    return editor.acceptReviewItem(item.key).ok;
  };

  const reject = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor || item.kind !== 'revision' || item.readOnly) return false;
    return editor.rejectReviewItem(item.key).ok;
  };

  const resolve = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor || item.kind !== 'comment') return false;
    return editor.setCommentResolved(item.key, true).ok;
  };

  const reopen = (item: ReviewItemView): boolean => {
    const editor = editorRef.value;
    if (!editor || item.kind !== 'comment') return false;
    return editor.setCommentResolved(item.key, false).ok;
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
    return editor.deleteReviewItem(item.key).ok;
  };

  const reply = (item: ReviewItemView, text: string, author?: string): boolean => {
    if (text.trim().length === 0 || !editorRef.value) return false;
    return editorRef.value.replyToReviewItem(item.key, text, author).ok;
  };

  const selectionAnchorY = computed((): number | null => {
    touch();
    const editor = editorRef.value;
    if (!editor) return null;
    return editor.getSelectionPlacement()?.anchorY ?? null;
  });

  const comment = (text: string, author?: string): boolean => {
    if (text.trim().length === 0 || !editorRef.value) return false;
    return editorRef.value.addComment(text, author).ok;
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
    setActive,
    accept,
    reject,
    resolve,
    reopen,
    commentResolutionDisabledReason,
    remove,
    reply,
    selectionAnchorY,
    comment,
    paneOpen,
    setPaneOpen,
    ready,
  };
}

/** @public */
export function useStackedReviewPositions(
  items: MaybeRefOrGetter<readonly { readonly key: string; readonly anchorY: number | null }[]>,
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
    const positions = new Map<string, number>();
    let cursor = Number.NEGATIVE_INFINITY;
    for (const entry of entries) {
      const top =
        entry.anchorY === null
          ? Number.isFinite(cursor)
            ? cursor
            : 0
          : Math.max(entry.anchorY, cursor);
      positions.set(entry.key, top);
      cursor = top + ((heightMap.get(entry.key) ?? defaultHeight) + gap) / scale;
    }
    return positions;
  });
}
