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

/** Longest a function source waits while changes keep arriving, such as remote typing. */
const HIGHLIGHT_REFRESH_MAX_WAIT_MS = 1000;

function createRefreshBatch(run: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstAt = 0;
  const fire = () => {
    timer = undefined;
    firstAt = 0;
    run();
  };
  return {
    schedule() {
      const now = Date.now();
      if (firstAt === 0) firstAt = now;
      clearTimeout(timer);
      const waited = now - firstAt;
      timer = setTimeout(
        fire,
        Math.max(0, Math.min(HIGHLIGHT_REFRESH_MS, HIGHLIGHT_REFRESH_MAX_WAIT_MS - waited))
      );
    },
    now() {
      clearTimeout(timer);
      fire();
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      firstAt = 0;
    },
  };
}

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
 *   (editor: Editor) => editor.findMatches(terms, { wholeWord: true }).flat(),
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
    const batch = createRefreshBatch(apply);
    const off = editor.on('change', (change) => {
      if (typeof source === 'function') {
        // A loaded or replaced document runs at once; edits are batched.
        if (change.source) batch.now();
        else batch.schedule();
      } else if (change.source === 'refresh' || change.source === 'recovery') {
        // A refresh removes every set; ranges of the same document apply again. A new
        // document's paragraphs are not the ones these ranges name, so a load does not.
        apply();
      } else if (change.source === 'load') {
        setResult({ applied: 0, unavailable: source.length });
      }
    });
    return () => {
      off();
      batch.cancel();
    };
  }, [editor, name, source, key]);

  return result;
}
