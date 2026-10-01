import { computed, ref, shallowRef, toValue, watch, type ComputedRef } from 'vue';
import { scopeDispose } from '../scope-dispose';
import type { EditorSnapshot, TextMatch } from '@docx-editor.dev/core/contracts/editor';
import type { MaybeRefOrGetter } from '../../maybe-ref-or-getter';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';

/** @public */
export const SEARCH_DEBOUNCE_MS = 150;

/** @public */
export const SEARCH_MATCH_LIMIT = 2000;

/** The highlight set name the search composable owns. @public */
export const SEARCH_HIGHLIGHT_SET = 'search';

/** Stacking priority of the search highlight set, above host sets at the default `0`. @public */
export const SEARCH_HIGHLIGHT_PRIORITY = 10;

const EMPTY_MATCHES: readonly TextMatch[] = Object.freeze([]);
const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/** Which matches `useDocumentSearch` marks in the document. @public */
export type DocumentSearchHighlight = 'all' | 'active' | 'none';

/** How `useDocumentSearch` behaves. @public */
export interface UseDocumentSearchOptions {
  /**
   * Which matches to mark: every match with the active one emphasized (`'all'`), only the
   * active match (`'active'`), or none (`'none'`). Default: `'all'`.
   */
  readonly highlight?: DocumentSearchHighlight;
}

/** @public */
export interface UseDocumentSearchResult {
  readonly query: ComputedRef<string>;
  readonly setQuery: (query: string) => void;
  readonly matchCase: ComputedRef<boolean>;
  readonly setMatchCase: (value: boolean) => void;
  readonly wholeWord: ComputedRef<boolean>;
  readonly setWholeWord: (value: boolean) => void;
  readonly matches: ComputedRef<readonly TextMatch[]>;
  readonly truncated: ComputedRef<boolean>;
  readonly activeIndex: ComputedRef<number>;
  readonly goTo: (index: number) => void;
  readonly next: () => void;
  readonly previous: () => void;
  readonly clear: () => void;
  readonly isPending: ComputedRef<boolean>;
}

/** @public */
export function useDocumentSearch(
  options: MaybeRefOrGetter<UseDocumentSearchOptions> = {}
): UseDocumentSearchResult {
  const editorRef = useDocxEditor();
  const snapshot = useEditorState(selectSnapshot);

  const query = ref('');
  const runQuery = ref('');
  const matchCase = ref(false);
  const wholeWord = ref(false);
  // Shallow: the engine recognizes its own match objects, and a deep ref would hand it proxies.
  const matches = shallowRef<readonly TextMatch[]>(EMPTY_MATCHES);
  const activeIndex = ref(-1);

  scopeDispose(
    watch([query, runQuery], ([q, rq], _previous, onCleanup) => {
      if (q === rq) return;
      const timer = setTimeout(() => {
        runQuery.value = q;
      }, SEARCH_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    })
  );

  const findOptions = computed(() => ({
    matchCase: matchCase.value,
    wholeWord: wholeWord.value,
  }));
  const highlight = computed(() => toValue(options).highlight ?? 'all');

  scopeDispose(
    watch(
      [editorRef, runQuery, findOptions, snapshot],
      () => {
        const editor = editorRef.value;
        const rq = runQuery.value;
        if (!editor || rq.length === 0) {
          matches.value = EMPTY_MATCHES;
          activeIndex.value = -1;
          return;
        }
        const next = editor.findMatches(rq, findOptions.value);
        if (matches.value !== next) matches.value = next;
      },
      { flush: 'post' }
    )
  );

  scopeDispose(
    watch(matches, (next, prev) => {
      if (prev !== next) {
        activeIndex.value =
          activeIndex.value >= 0 && activeIndex.value < next.length ? activeIndex.value : -1;
      }
    })
  );

  // Mark the matches. The set follows the result list and the active index; an editor swap
  // or a scope disposal clears it on the editor that painted it.
  scopeDispose(
    watch(
      [editorRef, matches, activeIndex, highlight],
      ([editor, list, active, mode], _previous, onCleanup) => {
        if (!editor) return;
        // A new result list arrives before the index clamp below settles.
        const index = active < list.length ? active : -1;
        const current = index >= 0 ? list[index] : undefined;
        const ranges = mode === 'all' ? list : mode === 'active' && current ? [current] : [];
        editor.setHighlights(SEARCH_HIGHLIGHT_SET, ranges, {
          activeIndex: mode === 'all' ? index : ranges.length > 0 ? 0 : -1,
          priority: SEARCH_HIGHLIGHT_PRIORITY,
        });
        onCleanup(() => {
          if (editorRef.value !== editor) editor.clearHighlights(SEARCH_HIGHLIGHT_SET);
        });
      },
      { immediate: true, flush: 'post' }
    )
  );
  scopeDispose(() => editorRef.value?.clearHighlights(SEARCH_HIGHLIGHT_SET));

  const goTo = (index: number) => {
    const match = matches.value[index];
    if (!match || !editorRef.value) return;
    editorRef.value.focus();
    const result = editorRef.value.selectMatch(match);
    if (result.ok) activeIndex.value = index;
  };

  const step = (delta: number) => {
    if (matches.value.length === 0) return;
    const from = activeIndex.value < 0 ? (delta > 0 ? -1 : 0) : activeIndex.value;
    const next = (from + delta + matches.value.length) % matches.value.length;
    goTo(next);
  };

  return {
    query: computed(() => query.value),
    setQuery: (value: string) => {
      query.value = value;
    },
    matchCase: computed(() => matchCase.value),
    setMatchCase: (value: boolean) => {
      matchCase.value = value;
    },
    wholeWord: computed(() => wholeWord.value),
    setWholeWord: (value: boolean) => {
      wholeWord.value = value;
    },
    matches: computed(() => matches.value),
    truncated: computed(() => matches.value.length >= SEARCH_MATCH_LIMIT),
    activeIndex: computed(() => activeIndex.value),
    goTo,
    next: () => step(1),
    previous: () => step(-1),
    clear: () => {
      query.value = '';
      runQuery.value = '';
      matches.value = EMPTY_MATCHES;
      activeIndex.value = -1;
    },
    isPending: computed(() => query.value !== runQuery.value),
  };
}
