// The find half of the navigation pane, UI-free.
//
// Matches come from `Editor.findMatches()` — a read over the canonical tree, memoized per
// revision inside the session — and moving to one goes through `Editor.selectMatch()`,
// which selects the match AND reveals its page. Finding is a read and selecting is a
// write, and this hook keeps them that way: typing in the box never moves the caret.
//
// TYPING IS DEBOUNCED, RESULTS ARE NOT. The query lags the input by one debounce so a
// document-wide scan does not run per keystroke; once a scan has run its results are
// re-derived on every editor tick, so editing the document updates the list underneath
// the same query. That re-derivation is free when nothing changed: the session's memo
// hands back the SAME array reference for an unchanged revision, and this hook bails on
// reference equality rather than re-rendering the panel.
//
// MATCHES ARE MARKED IN THE DOCUMENT. The hook owns the `search` highlight set: every match
// by default, the active one in its own color. It clears the set when the query empties and
// on unmount, so a closed search leaves nothing painted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorSnapshot, TextMatch } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';

/** Milliseconds of quiet before a typed query is run against the document. */
export const SEARCH_DEBOUNCE_MS = 150;

/**
 * The engine's cap on one search. A full result array means "at least this many"; the
 * hook reports that as {@link UseDocumentSearchResult.truncated}.
 */
export const SEARCH_MATCH_LIMIT = 2000;

/** The highlight set name the search hook owns. @public */
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

/** What `useDocumentSearch` answers. @public */
export interface UseDocumentSearchResult {
  /** The text in the search box, updated synchronously as the user types. */
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly matchCase: boolean;
  readonly setMatchCase: (value: boolean) => void;
  readonly wholeWord: boolean;
  readonly setWholeWord: (value: boolean) => void;
  /** Matches for the last RUN query, in document order. */
  readonly matches: readonly TextMatch[];
  /**
   * Whether the engine stopped at its cap with matches still ahead of it, so a count
   * should read "2000+" rather than an exact total. A search that lands on exactly the cap
   * reports true; over-reporting by one is the honest direction.
   */
  readonly truncated: boolean;
  /** Index of the match the caret was last sent to, or `-1` before any navigation. */
  readonly activeIndex: number;
  /** Select a match by index and bring its page into view. Out-of-range is a no-op. */
  readonly goTo: (index: number) => void;
  /** Next / previous match, wrapping at the ends the way Word's arrows do. */
  readonly next: () => void;
  readonly previous: () => void;
  /** Empty the box and drop the results, without touching the selection. */
  readonly clear: () => void;
  /** Whether a typed query is waiting for its debounce to elapse. */
  readonly isPending: boolean;
}

/**
 * The find panel's behavior, with no UI attached.
 *
 * @public
 */
export function useDocumentSearch(options: UseDocumentSearchOptions = {}): UseDocumentSearchResult {
  const highlight = options.highlight ?? 'all';
  const editor = useDocxEditor();
  const snapshot = useEditorState(selectSnapshot);

  const [query, setQueryState] = useState('');
  const [runQuery, setRunQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matches, setMatches] = useState<readonly TextMatch[]>(EMPTY_MATCHES);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Debounce the TYPED query into the RUN query. Flag changes are not debounced: they come
  // from a click, at click frequency, and waiting after one reads as lag.
  useEffect(() => {
    if (query === runQuery) return undefined;
    const timer = setTimeout(() => setRunQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runQuery]);

  const findOptions = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord]);

  // Re-derive on the run query, the flags, and every editor tick. `snapshot` is the tick:
  // its identity moves when the document or the selection does, and an unchanged revision
  // hands back the same array so the state write below is skipped.
  useEffect(() => {
    if (!editor || runQuery.length === 0) {
      setMatches(EMPTY_MATCHES);
      setActiveIndex(-1);
      return;
    }
    const next = editor.findMatches(runQuery, findOptions);
    setMatches((current) => (current === next ? current : next));
  }, [editor, runQuery, findOptions, snapshot]);

  // A changed result set invalidates the cursor. Clamping instead of resetting would point
  // at a different match than the one the user was on, which is worse than starting over.
  const matchesRef = useRef(matches);
  useEffect(() => {
    if (matchesRef.current !== matches) {
      matchesRef.current = matches;
      setActiveIndex((current) => (current >= 0 && current < matches.length ? current : -1));
    }
  }, [matches]);

  // Mark the matches. The set follows the result list and the active index, and an unmount
  // or an editor swap clears it on the editor that painted it.
  useEffect(() => {
    if (!editor) return undefined;
    // A new result list arrives one render before the index clamp above settles.
    const index = activeIndex < matches.length ? activeIndex : -1;
    const active = index >= 0 ? matches[index] : undefined;
    const ranges = highlight === 'all' ? matches : highlight === 'active' && active ? [active] : [];
    editor.setHighlights(SEARCH_HIGHLIGHT_SET, ranges, {
      activeIndex: highlight === 'all' ? index : ranges.length > 0 ? 0 : -1,
      priority: SEARCH_HIGHLIGHT_PRIORITY,
    });
    return undefined;
  }, [editor, matches, activeIndex, highlight]);
  useEffect(() => {
    if (!editor) return undefined;
    return () => editor.clearHighlights(SEARCH_HIGHLIGHT_SET);
  }, [editor]);

  const goTo = useCallback(
    (index: number) => {
      if (!editor) return;
      const match = matches[index];
      if (!match) return;
      editor.focus();
      // Selects the match AND reveals its page: the engine knows which page the block is
      // on, so this never reaches into the DOM for a page that may not be materialised.
      const result = editor.selectMatch(match);
      if (result.ok) setActiveIndex(index);
    },
    [editor, matches]
  );

  // Wrapping, the way Word's next/previous arrows do: past the last match is the first.
  const step = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      const from = activeIndex < 0 ? (delta > 0 ? -1 : 0) : activeIndex;
      const next = (from + delta + matches.length) % matches.length;
      goTo(next);
    },
    [activeIndex, goTo, matches.length]
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  const setQuery = useCallback((value: string) => setQueryState(value), []);
  const clear = useCallback(() => {
    setQueryState('');
    setRunQuery('');
    setMatches(EMPTY_MATCHES);
    setActiveIndex(-1);
  }, []);

  return {
    query,
    setQuery,
    matchCase,
    setMatchCase,
    wholeWord,
    setWholeWord,
    matches,
    truncated: matches.length >= SEARCH_MATCH_LIMIT,
    activeIndex,
    goTo,
    next,
    previous,
    clear,
    isPending: query !== runQuery,
  };
}
