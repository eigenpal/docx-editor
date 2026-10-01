// A named text highlight set for as long as a component is mounted.
//
// The hook owns one `Editor.setHighlights()` set: it applies the ranges when they or the
// options change, and clears the set on unmount. A FUNCTION source runs again after document
// changes: at once when a document loads, batched after edits, so marks follow typing without
// a scan per keystroke. Between a change and the next run, the engine keeps every mark whose
// text is unchanged and hides the rest.

import { useEffect, useRef, useState } from 'react';
import type {
  Editor,
  HighlightOptions,
  HighlightRange,
  HighlightResult,
} from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';

/**
 * Ranges for `useHighlights`: an array, or a function of the editor that the hook calls
 * again after document changes. Keep a function stable with `useCallback`. @public
 */
export type HighlightSource =
  | readonly HighlightRange[]
  | ((editor: Editor) => readonly HighlightRange[]);

/** Milliseconds a function source waits after a document change before it runs again. @public */
export const HIGHLIGHT_REFRESH_MS = 150;

const EMPTY_RESULT: HighlightResult = Object.freeze({ applied: 0, unavailable: 0 });

function optionsKey(options: HighlightOptions | undefined): string {
  if (!options) return '';
  const { color, activeColor, activeIndex, className, priority } = options;
  return JSON.stringify([color, activeColor, activeIndex, className, priority]);
}

/**
 * Mark text ranges as the named set while the component is mounted.
 *
 * Returns what the last application resolved. Use a unique `name` per hook: two hooks with
 * the same name replace each other's ranges.
 *
 * @example
 * ```tsx
 * const findTerms = useCallback(
 *   (editor: Editor) => terms.flatMap((term) => editor.findMatches(term, { wholeWord: true })),
 *   [terms]
 * );
 * useHighlights('glossary', findTerms, { className: 'glossary-term' });
 * ```
 * @public
 */
export function useHighlights(
  name: string,
  source: HighlightSource,
  options?: HighlightOptions
): HighlightResult {
  const editor = useDocxEditor();
  const [result, setResult] = useState(EMPTY_RESULT);
  // Options compare by value, so an inline object literal does not reapply every render.
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const key = optionsKey(options);

  // Clear only when the set itself goes away. Reapplying replaces the set in place, which
  // keeps its stacking position among sets of equal priority.
  useEffect(() => {
    if (!editor) return undefined;
    return () => editor.clearHighlights(name);
  }, [editor, name]);

  useEffect(() => {
    if (!editor) {
      setResult(EMPTY_RESULT);
      return undefined;
    }
    const apply = () => {
      const ranges = typeof source === 'function' ? source(editor) : source;
      const next = editor.setHighlights(name, ranges, latestOptions.current);
      setResult((previous) =>
        previous.applied === next.applied && previous.unavailable === next.unavailable
          ? previous
          : next
      );
    };
    apply();
    if (typeof source !== 'function') return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = editor.on('change', (change) => {
      clearTimeout(timer);
      // A loaded or replaced document runs at once; edits are batched.
      if (change.source) apply();
      else timer = setTimeout(apply, HIGHLIGHT_REFRESH_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [editor, name, source, key]);

  return result;
}
