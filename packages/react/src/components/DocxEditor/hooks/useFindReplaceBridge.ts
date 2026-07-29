/**
 * The find/replace dialog's bridge to the document.
 *
 * PORTED from the legacy hook of the same name. The handler names, the `findResultRef`
 * that carries the last result between calls, and the wrap-around stepping are legacy's.
 *
 * Where legacy searched the editing engine's document itself and dispatched transactions
 * against ProseMirror positions, each of those is a capability now:
 *
 *  - `findMatches` returns matches carrying BOTH addresses — the engine's `blockId` +
 *    offset and the paragraph/run/offset triple this dialog navigates by.
 *  - `selectMatch` moves the selection to one. It is a stub that refuses, so stepping
 *    reports "no move" rather than advancing a counter past a caret that did not move.
 *  - `replaceMatch` and `replaceAllMatches` join the contract for this hook. Replace-all
 *    is a single command rather than a loop here for legacy's own reason: each
 *    replacement shifts the offsets after it, and legacy applied its edits back-to-front
 *    to cope. That ordering belongs with whoever owns the offsets, which is the engine.
 */
import { useCallback, useRef } from 'react';
import type { Editor, TextMatch } from '@docx-editor.dev/core-contract/contracts/editor';
import type { FindMatch, FindOptions, FindResult } from '../../dialogs/findReplaceUtils';

export function useFindReplaceBridge({ editorRef }: { editorRef: React.RefObject<Editor | null> }) {
  const findResultRef = useRef<FindResult | null>(null);
  // The engine-addressed matches behind the dialog's view of them, kept in step by index.
  const engineMatchesRef = useRef<readonly TextMatch[]>([]);

  const toFindMatch = useCallback(
    (m: TextMatch): FindMatch => ({
      paragraphIndex: m.paragraphIndex,
      contentIndex: m.runIndex,
      startOffset: m.runOffset,
      endOffset: m.runOffset + m.length,
      text: m.text,
    }),
    []
  );

  const handleFind = useCallback(
    (searchText: string, options: FindOptions): FindResult | null => {
      const matches =
        editorRef.current?.findMatches(searchText, {
          matchCase: options.matchCase,
          wholeWord: options.matchWholeWord,
        }) ?? [];
      engineMatchesRef.current = matches;
      const result: FindResult = {
        matches: matches.map(toFindMatch),
        totalCount: matches.length,
        currentIndex: matches.length > 0 ? 0 : -1,
      };
      findResultRef.current = result;
      return result;
    },
    [editorRef, toFindMatch]
  );

  const step = useCallback(
    (delta: 1 | -1): FindMatch | null => {
      const result = findResultRef.current;
      const matches = engineMatchesRef.current;
      if (!result || matches.length === 0) return null;
      const next = (result.currentIndex + delta + matches.length) % matches.length;
      // Only advance when the engine actually moved the selection. Reporting a new
      // current match while the caret stayed put is the lie this guards against.
      if (!editorRef.current?.selectMatch(matches[next]!).ok) return null;
      result.currentIndex = next;
      return toFindMatch(matches[next]!);
    },
    [editorRef, toFindMatch]
  );

  const handleFindNext = useCallback((): FindMatch | null => step(1), [step]);
  const handleFindPrevious = useCallback((): FindMatch | null => step(-1), [step]);

  const handleReplace = useCallback(
    (replaceText: string): boolean => {
      const result = findResultRef.current;
      const matches = engineMatchesRef.current;
      if (!result || result.currentIndex < 0) return false;
      const match = matches[result.currentIndex];
      if (!match) return false;
      return (
        editorRef.current?.exec({ type: 'replaceMatch', match, text: replaceText }).ok ?? false
      );
    },
    [editorRef]
  );

  const handleReplaceAll = useCallback(
    (searchText: string, replaceText: string, options: FindOptions): number => {
      if (!searchText.trim()) return 0;
      const editor = editorRef.current;
      if (!editor) return 0;
      const matches = editor.findMatches(searchText, {
        matchCase: options.matchCase,
        wholeWord: options.matchWholeWord,
      });
      if (matches.length === 0) return 0;
      const result = editor.exec({
        type: 'replaceAllMatches',
        query: searchText,
        text: replaceText,
        matchCase: options.matchCase,
        wholeWord: options.matchWholeWord,
      });
      // Report what actually happened. Returning the match count from a refused command
      // would tell the dialog it replaced things it did not.
      if (!result.ok) return 0;
      findResultRef.current = null;
      engineMatchesRef.current = [];
      return matches.length;
    },
    [editorRef]
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
