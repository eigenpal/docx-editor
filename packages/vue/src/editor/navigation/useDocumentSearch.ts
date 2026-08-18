import { computed, onScopeDispose, ref, watch, type ComputedRef } from 'vue';
import type { EditorSnapshot, TextMatch } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';

/** @public */
export const SEARCH_DEBOUNCE_MS = 150;

/** @public */
export const SEARCH_MATCH_LIMIT = 2000;

const EMPTY_MATCHES: readonly TextMatch[] = Object.freeze([]);
const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

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
export function useDocumentSearch(): UseDocumentSearchResult {
  const editorRef = useDocxEditor();
  const snapshot = useEditorState(selectSnapshot);

  const query = ref('');
  const runQuery = ref('');
  const matchCase = ref(false);
  const wholeWord = ref(false);
  const matches = ref<readonly TextMatch[]>(EMPTY_MATCHES);
  const activeIndex = ref(-1);

  onScopeDispose(
    watch([query, runQuery], ([q, rq]) => {
      if (q === rq) return;
      const timer = setTimeout(() => {
        runQuery.value = q;
      }, SEARCH_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    })
  );

  const options = computed(() => ({ matchCase: matchCase.value, wholeWord: wholeWord.value }));

  onScopeDispose(
    watch(
      [editorRef, runQuery, options, snapshot],
      () => {
        const editor = editorRef.value;
        const rq = runQuery.value;
        if (!editor || rq.length === 0) {
          matches.value = EMPTY_MATCHES;
          activeIndex.value = -1;
          return;
        }
        const next = editor.findMatches(rq, options.value);
        if (matches.value !== next) matches.value = next;
      },
      { flush: 'post' }
    )
  );

  onScopeDispose(
    watch(matches, (next, prev) => {
      if (prev !== next) {
        activeIndex.value =
          activeIndex.value >= 0 && activeIndex.value < next.length ? activeIndex.value : -1;
      }
    })
  );

  const goTo = (index: number) => {
    const editor = editorRef.value;
    if (!editor) return;
    const match = matches.value[index];
    if (!match) return;
    editor.focus();
    const result = editor.selectMatch(match);
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
