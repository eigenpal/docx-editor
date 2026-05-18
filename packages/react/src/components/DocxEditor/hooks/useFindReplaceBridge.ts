import { useCallback, useRef } from 'react';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import { executeCommand } from '@eigenpal/docx-editor-core/agent';
import {
  findInDocument,
  scrollToMatch,
  type FindMatch,
  type FindOptions,
  type FindResult,
} from '../../dialogs/FindReplaceDialog';
import type { useFindReplace } from '../../../hooks/useFindReplace';

/**
 * Bridges the find/replace dialog hook to the document: searches over
 * the latest Document model, scrolls matches into view, replaces single
 * or all occurrences via the agent command pipeline. The dialog UI state
 * itself (open/closed, current term) lives in `findReplace`.
 */
export function useFindReplaceBridge({
  document,
  containerRef,
  findReplace,
  handleDocumentChange,
}: {
  document: Document | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  findReplace: ReturnType<typeof useFindReplace>;
  handleDocumentChange: (doc: Document) => void;
}) {
  const findResultRef = useRef<FindResult | null>(null);

  const handleFind = useCallback(
    (searchText: string, options: FindOptions): FindResult | null => {
      if (!document || !searchText.trim()) {
        findResultRef.current = null;
        return null;
      }

      const matches = findInDocument(document, searchText, options);
      const result: FindResult = {
        matches,
        totalCount: matches.length,
        currentIndex: 0,
      };

      findResultRef.current = result;
      findReplace.setMatches(matches, 0);

      if (matches.length > 0 && containerRef.current) {
        scrollToMatch(containerRef.current, matches[0]);
      }

      return result;
    },
    [document, containerRef, findReplace]
  );

  const handleFindNext = useCallback((): FindMatch | null => {
    if (!findResultRef.current || findResultRef.current.matches.length === 0) {
      return null;
    }
    const newIndex = findReplace.goToNextMatch();
    const match = findResultRef.current.matches[newIndex];
    if (match && containerRef.current) {
      scrollToMatch(containerRef.current, match);
    }
    return match || null;
  }, [containerRef, findReplace]);

  const handleFindPrevious = useCallback((): FindMatch | null => {
    if (!findResultRef.current || findResultRef.current.matches.length === 0) {
      return null;
    }
    const newIndex = findReplace.goToPreviousMatch();
    const match = findResultRef.current.matches[newIndex];
    if (match && containerRef.current) {
      scrollToMatch(containerRef.current, match);
    }
    return match || null;
  }, [containerRef, findReplace]);

  const handleReplace = useCallback(
    (replaceText: string): boolean => {
      if (!document || !findResultRef.current || findResultRef.current.matches.length === 0) {
        return false;
      }
      const currentMatch = findResultRef.current.matches[findResultRef.current.currentIndex];
      if (!currentMatch) return false;

      try {
        const newDoc = executeCommand(document, {
          type: 'replaceText',
          range: {
            start: {
              paragraphIndex: currentMatch.paragraphIndex,
              offset: currentMatch.startOffset,
            },
            end: {
              paragraphIndex: currentMatch.paragraphIndex,
              offset: currentMatch.endOffset,
            },
          },
          text: replaceText,
        });
        handleDocumentChange(newDoc);
        return true;
      } catch (error) {
        console.error('Replace failed:', error);
        return false;
      }
    },
    [document, handleDocumentChange]
  );

  const handleReplaceAll = useCallback(
    (searchText: string, replaceText: string, options: FindOptions): number => {
      if (!document || !searchText.trim()) {
        return 0;
      }
      const matches = findInDocument(document, searchText, options);
      if (matches.length === 0) return 0;

      // Apply from end to start so earlier match indices stay valid.
      let doc = document;
      const sortedMatches = [...matches].sort((a, b) => {
        if (a.paragraphIndex !== b.paragraphIndex) {
          return b.paragraphIndex - a.paragraphIndex;
        }
        return b.startOffset - a.startOffset;
      });

      for (const match of sortedMatches) {
        try {
          doc = executeCommand(doc, {
            type: 'replaceText',
            range: {
              start: { paragraphIndex: match.paragraphIndex, offset: match.startOffset },
              end: { paragraphIndex: match.paragraphIndex, offset: match.endOffset },
            },
            text: replaceText,
          });
        } catch (error) {
          console.error('Replace failed for match:', match, error);
        }
      }

      handleDocumentChange(doc);
      findResultRef.current = null;
      findReplace.setMatches([], 0);

      return matches.length;
    },
    [document, handleDocumentChange, findReplace]
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
