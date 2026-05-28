import { useCallback, useRef } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  findAllMatches,
  type FindMatch,
  type FindOptions,
  type FindResult,
} from '../../dialogs/findReplaceUtils';
import type { useFindReplace } from '../../../hooks/useFindReplace';
import type { PagedEditorRef } from '../PagedEditor';

type PmFindMatch = FindMatch & {
  pmFrom: number;
  pmTo: number;
};

type PmFindResult = FindResult & {
  matches: PmFindMatch[];
};

type TextSegment = {
  text: string;
  docFrom: number;
};

function resolveTextOffset(segments: TextSegment[], offset: number, bias: 'start' | 'end') {
  let textOffset = 0;

  for (const segment of segments) {
    const nextOffset = textOffset + segment.text.length;

    if (
      (bias === 'start' && offset >= textOffset && offset < nextOffset) ||
      (bias === 'end' && offset > textOffset && offset <= nextOffset)
    ) {
      return segment.docFrom + offset - textOffset;
    }

    textOffset = nextOffset;
  }

  return null;
}

function findMatchesInView(view: EditorView, searchText: string, options: FindOptions) {
  const matches: PmFindMatch[] = [];
  let paragraphIndex = 0;

  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    const segments: TextSegment[] = [];
    let paragraphText = '';

    node.descendants((child, childOffset) => {
      if (!child.isText || !child.text) return true;
      segments.push({
        text: child.text,
        docFrom: pos + 1 + childOffset,
      });
      paragraphText += child.text;
      return true;
    });

    if (!paragraphText) {
      paragraphIndex += 1;
      return false;
    }

    const textMatches = findAllMatches(paragraphText, searchText, options);
    for (const match of textMatches) {
      const pmFrom = resolveTextOffset(segments, match.start, 'start');
      const pmTo = resolveTextOffset(segments, match.end, 'end');
      if (pmFrom == null || pmTo == null || pmFrom >= pmTo) continue;

      matches.push({
        paragraphIndex,
        contentIndex: 0,
        startOffset: match.start,
        endOffset: match.end,
        text: paragraphText.slice(match.start, match.end),
        pmFrom,
        pmTo,
      });
    }

    paragraphIndex += 1;
    return false;
  });

  return matches;
}

/**
 * Bridges the find/replace dialog hook to the paged editor: searches the
 * live ProseMirror document, selects the active PM range, and scrolls the
 * visible pages through PagedEditor's scroll API. The dialog UI state itself
 * (open/closed, current term) lives in `findReplace`.
 */
export function useFindReplaceBridge({
  pagedEditorRef,
  findReplace,
}: {
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  findReplace: ReturnType<typeof useFindReplace>;
}) {
  const findResultRef = useRef<FindResult | null>(null);

  const getView = useCallback(() => pagedEditorRef.current?.getView() ?? null, [pagedEditorRef]);

  const goToMatch = useCallback(
    (match: PmFindMatch | undefined, index: number): FindMatch | null => {
      const view = getView();
      if (!view || !match) return null;

      try {
        const selection = TextSelection.create(view.state.doc, match.pmFrom, match.pmTo);
        view.dispatch(view.state.tr.setSelection(selection));
        pagedEditorRef.current?.scrollToPosition(match.pmFrom);
      } catch (error) {
        console.error('Find navigation failed:', error);
        return null;
      }

      const currentResult = findResultRef.current as PmFindResult | null;
      if (currentResult) {
        currentResult.currentIndex = index;
      }
      findReplace.goToMatch(index);
      return match;
    },
    [findReplace, getView, pagedEditorRef]
  );

  const handleFind = useCallback(
    (searchText: string, options: FindOptions): FindResult | null => {
      const view = getView();
      if (!view || !searchText.trim()) {
        findResultRef.current = null;
        findReplace.setMatches([], 0);
        return null;
      }

      const matches = findMatchesInView(view, searchText, options);
      const result: PmFindResult = {
        matches,
        totalCount: matches.length,
        currentIndex: 0,
      };

      findResultRef.current = result;
      findReplace.setMatches(matches, 0);

      if (matches.length > 0) {
        goToMatch(matches[0], 0);
      }

      return result;
    },
    [findReplace, getView, goToMatch]
  );

  const handleFindNext = useCallback((): FindMatch | null => {
    const result = findResultRef.current as PmFindResult | null;
    if (!result || result.matches.length === 0) {
      return null;
    }
    const newIndex = (result.currentIndex + 1) % result.matches.length;
    return goToMatch(result.matches[newIndex], newIndex);
  }, [goToMatch]);

  const handleFindPrevious = useCallback((): FindMatch | null => {
    const result = findResultRef.current as PmFindResult | null;
    if (!result || result.matches.length === 0) {
      return null;
    }
    const newIndex =
      result.currentIndex === 0 ? result.matches.length - 1 : result.currentIndex - 1;
    return goToMatch(result.matches[newIndex], newIndex);
  }, [goToMatch]);

  const handleReplace = useCallback(
    (replaceText: string): boolean => {
      const view = getView();
      const result = findResultRef.current as PmFindResult | null;
      if (!view || !result || result.matches.length === 0) {
        return false;
      }
      const currentMatch = result.matches[result.currentIndex];
      if (!currentMatch) return false;

      try {
        const tr = replaceText
          ? view.state.tr.replaceWith(
              currentMatch.pmFrom,
              currentMatch.pmTo,
              view.state.schema.text(replaceText)
            )
          : view.state.tr.delete(currentMatch.pmFrom, currentMatch.pmTo);
        view.dispatch(tr);
        return true;
      } catch (error) {
        console.error('Replace failed:', error);
        return false;
      }
    },
    [getView]
  );

  const handleReplaceAll = useCallback(
    (searchText: string, replaceText: string, options: FindOptions): number => {
      const view = getView();
      if (!view || !searchText.trim()) {
        return 0;
      }
      const matches = findMatchesInView(view, searchText, options);
      if (matches.length === 0) return 0;

      // Apply from end to start so earlier match indices stay valid.
      const sortedMatches = [...matches].sort((a, b) => b.pmFrom - a.pmFrom);
      let tr = view.state.tr;

      for (const match of sortedMatches) {
        try {
          tr = replaceText
            ? tr.replaceWith(match.pmFrom, match.pmTo, view.state.schema.text(replaceText))
            : tr.delete(match.pmFrom, match.pmTo);
        } catch (error) {
          console.error('Replace failed for match:', match, error);
        }
      }

      view.dispatch(tr);
      findResultRef.current = null;
      findReplace.setMatches([], 0);

      return matches.length;
    },
    [findReplace, getView]
  );

  return {
    findResultRef,
    handleFind,
    handleFindNext,
    handleFindPrevious,
    handleReplace,
    handleReplaceAll,
  };
}
