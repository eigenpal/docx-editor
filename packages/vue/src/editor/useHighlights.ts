import { computed, shallowRef, toRaw, toValue, watch, type ComputedRef } from 'vue';
import { scopeDispose } from './scope-dispose';
import type {
  Editor,
  HighlightOptions,
  HighlightRange,
  HighlightResult,
} from '@docx-editor.dev/core/contracts/editor';
import { HIGHLIGHT_REFRESH_MS, type HighlightSource } from '@docx-editor.dev/core/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';
import { useDocxEditor } from './context';

export { HIGHLIGHT_REFRESH_MS, type HighlightSource };

/** Longest a function source waits while changes keep arriving, such as remote typing. */
const HIGHLIGHT_REFRESH_MAX_WAIT_MS = 1000;

const EMPTY_RESULT: HighlightResult = Object.freeze({ applied: 0, unavailable: 0 });

/**
 * Mark text ranges as the named set while the calling scope is active.
 *
 * A function source runs inside reactive tracking, so a getter that reads refs reapplies
 * when they change. Use a unique `name` per call: two calls with the same name replace each
 * other's ranges.
 *
 * @example
 * ```ts
 * useHighlights(
 *   'glossary',
 *   (editor) => editor.findMatches(terms.value, { wholeWord: true }).flat(),
 *   { className: 'glossary-term' }
 * );
 * ```
 * @public
 */
export function useHighlights(
  name: MaybeRefOrGetter<string>,
  source: MaybeRefOrGetter<HighlightSource>,
  options?: MaybeRefOrGetter<HighlightOptions>
): ComputedRef<HighlightResult> {
  const editorRef = useDocxEditor();
  const result = shallowRef(EMPTY_RESULT);
  // Bumped after document changes, so a function source runs again.
  const documentTick = shallowRef(0);
  // Bumped after a refresh or recovery, so any source applies again.
  const refreshTick = shallowRef(0);
  let owned: { readonly editor: Editor; readonly name: string } | null = null;
  scopeDispose(() => owned?.editor.clearHighlights(owned.name));

  // A FUNCTION source runs again after document changes; a fixed array does not. A getter
  // that returns a fixed array may run again too: the engine compares each range against the
  // text it first covered, so setting the same ranges again never moves a mark.
  const resolveRanges = (editor: Editor): readonly HighlightRange[] => {
    let value: unknown = typeof source === 'function' ? source(editor) : toValue(source);
    if (typeof source === 'function' || typeof value === 'function') void documentTick.value;
    // A getter or ref may hold the editor function itself.
    if (typeof value === 'function') value = (value as (editor: Editor) => unknown)(editor);
    // Hand the engine the raw objects: it recognizes search results by identity, and a
    // reactive array would pass proxies.
    return Array.isArray(value) ? value.map((range) => toRaw(range)) : (value as never);
  };
  // Read each field, so a reactive options object reapplies when one changes.
  const resolveOptions = (): HighlightOptions | undefined => {
    const value = toValue(options);
    if (!value) return undefined;
    const { color, activeColor, activeIndex, className, priority } = value;
    return { color, activeColor, activeIndex, className, priority };
  };

  watch(
    () => {
      const editor = editorRef.value;
      if (!editor) return null;
      void refreshTick.value;
      return {
        editor,
        name: toValue(name),
        ranges: resolveRanges(editor),
        options: resolveOptions(),
      };
    },
    (next) => {
      // Clear only when the set itself goes away. Reapplying replaces the set in place,
      // which keeps its stacking position among sets of equal priority.
      if (owned && (owned.editor !== next?.editor || owned.name !== next?.name)) {
        owned.editor.clearHighlights(owned.name);
        owned = null;
      }
      if (!next) {
        result.value = EMPTY_RESULT;
        return;
      }
      owned = { editor: next.editor, name: next.name };
      const applied = next.editor.setHighlights(next.name, next.ranges, next.options);
      if (
        applied.applied !== result.value.applied ||
        applied.unavailable !== result.value.unavailable
      ) {
        result.value = applied;
      }
    },
    { immediate: true, flush: 'post' }
  );

  watch(
    () => editorRef.value,
    (editor, _previous, onCleanup) => {
      if (!editor) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let firstAt = 0;
      const bump = () => {
        timer = undefined;
        firstAt = 0;
        documentTick.value += 1;
      };
      const off = editor.on('change', (change) => {
        clearTimeout(timer);
        if (change.source === 'refresh' || change.source === 'recovery') {
          // A refresh removes every set; ranges of the same document apply again.
          refreshTick.value += 1;
        } else if (change.source === 'load' && typeof source !== 'function') {
          // A new document's paragraphs are not the ones fixed ranges name: report them gone.
          // Never `toValue` a function source here: that would call it without the editor.
          const ranges = toValue(source);
          if (Array.isArray(ranges)) result.value = { applied: 0, unavailable: ranges.length };
        }
        // A loaded or replaced document runs at once; edits are batched, with a cap on the
        // wait while changes keep arriving.
        if (change.source) {
          bump();
          return;
        }
        const now = Date.now();
        if (firstAt === 0) firstAt = now;
        timer = setTimeout(
          bump,
          Math.max(
            0,
            Math.min(HIGHLIGHT_REFRESH_MS, HIGHLIGHT_REFRESH_MAX_WAIT_MS - (now - firstAt))
          )
        );
      });
      onCleanup(() => {
        off();
        clearTimeout(timer);
      });
    },
    { immediate: true }
  );

  return computed(() => result.value);
}
