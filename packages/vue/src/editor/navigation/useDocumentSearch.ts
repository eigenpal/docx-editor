// The find half of the navigation pane, UI-free: a thin binding over the editor's shared
// search session (`createDocumentSearch`). Every `useDocumentSearch` call and the packaged
// Find pane drive the same session, so state set here shows in the pane and back.

import { computed, shallowRef, toValue, watch, type ComputedRef } from 'vue';
import type { TextMatch } from '@docx-editor.dev/core/contracts/editor';
import {
  createDocumentSearch,
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_PRIORITY,
  SEARCH_HIGHLIGHT_SET,
  SEARCH_MATCH_LIMIT,
  type DocumentSearch,
  type DocumentSearchHighlight,
  type DocumentSearchNavigateOptions,
  type DocumentSearchOptions,
  type DocumentSearchState,
} from '@docx-editor.dev/core/editor';
import { scopeDispose } from '../scope-dispose';
import type { MaybeRefOrGetter } from '../../maybe-ref-or-getter';
import { useDocxEditor } from '../context';

export {
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_PRIORITY,
  SEARCH_HIGHLIGHT_SET,
  SEARCH_MATCH_LIMIT,
  type DocumentSearchHighlight,
  type DocumentSearchNavigateOptions,
  type DocumentSearchOptions,
};

const IDLE_STATE: DocumentSearchState = Object.freeze({
  query: '',
  matchCase: false,
  wholeWord: false,
  matches: Object.freeze([]) as readonly TextMatch[],
  truncated: false,
  activeIndex: -1,
  isPending: false,
});

/** How `useDocumentSearch` behaves. @public */
export interface UseDocumentSearchOptions {
  /**
   * Which matches to mark: every match with the active one emphasized (`'all'`), only the
   * active match (`'active'`), or none (`'none'`). Default: `'all'`.
   */
  readonly highlight?: DocumentSearchHighlight;
}

/** What `useDocumentSearch` answers. @public */
export interface UseDocumentSearchResult {
  /** The text in the search box, updated synchronously as the user types. */
  readonly query: ComputedRef<string>;
  /** Update the typed query. The search runs after a short debounce. */
  readonly setQuery: (query: string) => void;
  /** Search now, without a debounce, and return the matches. */
  readonly find: (query: string, options?: DocumentSearchOptions) => readonly TextMatch[];
  readonly matchCase: ComputedRef<boolean>;
  readonly setMatchCase: (value: boolean) => void;
  readonly wholeWord: ComputedRef<boolean>;
  readonly setWholeWord: (value: boolean) => void;
  /** Matches for the last searched query, in document order. */
  readonly matches: ComputedRef<readonly TextMatch[]>;
  /** The search stopped at its cap with matches still ahead, so a count reads "2000+". */
  readonly truncated: ComputedRef<boolean>;
  /** Index of the current match, or `-1` before any navigation. */
  readonly activeIndex: ComputedRef<number>;
  /**
   * Select a match by index and bring its page into view. Focus stays where it is, so a
   * search box keeps it. Returns false for an index without a match.
   */
  readonly goTo: (index: number) => boolean;
  /** Next / previous match, wrapping at the ends the way Word's arrows do. */
  readonly next: () => boolean;
  readonly previous: () => boolean;
  /** Empty the query and drop the results, without changing the selection. */
  readonly clear: () => void;
  /** Whether a typed query is waiting for its debounce to elapse. */
  readonly isPending: ComputedRef<boolean>;
}

/**
 * The editor's shared search, with no UI attached. The packaged Find pane uses the same
 * session, so state set here shows there.
 *
 * @public
 */
export function useDocumentSearch(
  options: MaybeRefOrGetter<UseDocumentSearchOptions> = {}
): UseDocumentSearchResult {
  const editorRef = useDocxEditor();
  // Shallow: the engine recognizes its own match objects, and a deep ref would hand it proxies.
  const state = shallowRef<DocumentSearchState>(IDLE_STATE);
  const session = shallowRef<DocumentSearch | null>(null);

  scopeDispose(
    watch(
      () => editorRef.value,
      (editor, _previous, onCleanup) => {
        const search = editor ? createDocumentSearch(editor) : null;
        session.value = search;
        state.value = search?.getState() ?? IDLE_STATE;
        if (!search) return;
        const off = search.subscribe(() => {
          state.value = search.getState();
        });
        onCleanup(off);
      },
      { immediate: true }
    )
  );

  // Ask for highlights for as long as this consumer wants them.
  scopeDispose(
    watch(
      [session, () => toValue(options).highlight ?? 'all'],
      ([search, mode], _previous, onCleanup) => {
        if (!search || mode === 'none') return;
        onCleanup(search.showHighlights(mode));
      },
      { immediate: true }
    )
  );

  return {
    query: computed(() => state.value.query),
    setQuery: (query) => session.value?.setQuery(query),
    find: (query, findOptions) => session.value?.find(query, findOptions) ?? IDLE_STATE.matches,
    matchCase: computed(() => state.value.matchCase),
    setMatchCase: (value) => session.value?.setMatchCase(value),
    wholeWord: computed(() => state.value.wholeWord),
    setWholeWord: (value) => session.value?.setWholeWord(value),
    matches: computed(() => state.value.matches),
    truncated: computed(() => state.value.truncated),
    activeIndex: computed(() => state.value.activeIndex),
    // No options: a handler such as `@click="search.next"` passes its event here.
    goTo: (index) => session.value?.goTo(index) ?? false,
    next: () => session.value?.next() ?? false,
    previous: () => session.value?.previous() ?? false,
    clear: () => session.value?.clear(),
    isPending: computed(() => state.value.isPending),
  };
}
