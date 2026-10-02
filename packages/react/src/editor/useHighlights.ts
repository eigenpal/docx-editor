// A named text highlight set for as long as a component is mounted: a binding over the
// engine's `watchHighlights`, which reruns a function source after document changes and
// applies fixed ranges again after a refresh.

import { useEffect, useRef, useState } from 'react';
import type { HighlightOptions, HighlightResult } from '@docx-editor.dev/core/contracts/editor';
import {
  HIGHLIGHT_REFRESH_MS,
  watchHighlights,
  type HighlightSource,
  type HighlightWatch,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';

export { HIGHLIGHT_REFRESH_MS, type HighlightSource };

const EMPTY_RESULT: HighlightResult = Object.freeze({ applied: 0, unavailable: 0 });

function optionsKey(options: HighlightOptions | undefined): string {
  if (!options) return '';
  const { color, activeColor, activeIndex, className, priority } = options;
  return JSON.stringify([color, activeColor, activeIndex, className, priority]);
}

/**
 * Highlight text ranges as the named set while the component is mounted, and keep them
 * current as the document changes. Returns what the last application resolved.
 *
 * Use a unique `name` per hook: two hooks with the same name replace each other's ranges.
 * Keep a function `source` stable with `useCallback`.
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
  const watchRef = useRef<{ watch: HighlightWatch; source: HighlightSource; key: string } | null>(
    null
  );
  // Options compare by value, so an inline object literal does not reapply every render.
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const latestSource = useRef(source);
  latestSource.current = source;
  const key = optionsKey(options);

  // One watch per editor and name. Stopping removes the set.
  useEffect(() => {
    if (!editor) {
      setResult(EMPTY_RESULT);
      return undefined;
    }
    const watch = watchHighlights(editor, name, latestSource.current, {
      ...latestOptions.current,
      onResult: setResult,
    });
    watchRef.current = {
      watch,
      source: latestSource.current,
      key: optionsKey(latestOptions.current),
    };
    setResult(watch.result);
    return () => {
      watch.stop();
      watchRef.current = null;
    };
  }, [editor, name]);

  // A new source or options update the set in place, keeping its stacking position.
  useEffect(() => {
    const current = watchRef.current;
    if (!current || (current.source === source && current.key === key)) return;
    current.source = source;
    current.key = key;
    current.watch.update(source, latestOptions.current ?? {});
  }, [source, key]);

  return result;
}
