import { computed, shallowRef, toRaw, toValue, watch, type ComputedRef } from 'vue';
import { scopeDispose } from './scope-dispose';
import type {
  Editor,
  HighlightOptions,
  HighlightRange,
  HighlightResult,
} from '@docx-editor.dev/core/contracts/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';
import { useDocxEditor } from './context';

/**
 * Ranges for `useHighlights`: an array, or a function of the editor that the composable
 * calls again after document changes and when the reactive state it reads changes. @public
 */
export type HighlightSource =
  | readonly HighlightRange[]
  | ((editor: Editor) => readonly HighlightRange[]);

/** Milliseconds a function source waits after a document change before it runs again. @public */
export const HIGHLIGHT_REFRESH_MS = 150;

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
 *   (editor) => terms.value.flatMap((term) => editor.findMatches(term, { wholeWord: true })),
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
      const off = editor.on('change', (change) => {
        clearTimeout(timer);
        // A loaded or replaced document runs at once; edits are batched.
        if (change.source) documentTick.value += 1;
        else
          timer = setTimeout(() => {
            documentTick.value += 1;
          }, HIGHLIGHT_REFRESH_MS);
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
