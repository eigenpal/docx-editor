import {
  computed,
  inject,
  shallowRef,
  unref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type MaybeRef,
  type ShallowRef,
} from 'vue';
import type { HighlightHit, HighlightRange } from '@docx-editor.dev/core/contracts/editor';
import { editorHostWindow } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { scopeDispose } from '../scope-dispose';
import { readContextMenuHighlights } from './menu-highlights';

/**
 * Where the panel opened, in client coordinates, and how it was opened.
 *
 * @public
 */
export interface ContextMenuAnchor {
  /** Horizontal client coordinate the panel opened at, in CSS pixels. */
  readonly x: number;
  /** Vertical client coordinate the panel opened at, in CSS pixels. */
  readonly y: number;
  /**
   * `pointer` for a right-click, which opens at the pointer. `keyboard` for Shift+F10 or the
   * Menu key, which opens below the caret, or at the top-left of the document area when the
   * caret is not on a painted page.
   */
  readonly trigger: 'pointer' | 'keyboard';
}

/** @public */
export interface ContextMenuContextValue {
  readonly close: (restoreFocus?: boolean) => void;
  readonly anchor: ContextMenuAnchor | null;
  readonly tocId: string | null;
  readonly target: HTMLElement | null;
  readonly clipboardRefusal: string | null;
  readonly reportClipboardRefusal: (reason: string) => void;
}

/** @public */
export const ContextMenuContext: InjectionKey<MaybeRef<ContextMenuContextValue>> =
  Symbol('ContextMenuContext');

const fallback: ContextMenuContextValue = {
  close: () => {},
  anchor: null,
  tocId: null,
  target: null,
  clipboardRefusal: null,
  reportClipboardRefusal: () => {},
};

/** @internal */
export function useContextMenuContext(): ContextMenuContextValue {
  return unref(inject(ContextMenuContext, fallback)) as ContextMenuContextValue;
}

/**
 * The element the opening right-click landed on, or null while the menu is closed.
 *
 * A menu opened from the keyboard has no target; read the caret with
 * `editor.getSelectionRange()`.
 *
 * @public
 */
export function useContextMenuTarget(): HTMLElement | null {
  const ctx = unref(inject(ContextMenuContext, fallback));
  const target: HTMLElement | null = ctx?.target ?? null;
  return target;
}

/**
 * Where the open menu is anchored and how it was opened, or null while the menu is closed.
 *
 * Rows in `ContextMenu.Start` read `trigger` to tell a right-click from a keyboard open,
 * which acts on the caret rather than on a pointer target. The ref follows the menu, so a
 * row that stays mounted while the menu opens again reads the new anchor.
 *
 * @public
 */
export function useContextMenuAnchor(): ComputedRef<ContextMenuAnchor | null> {
  const context = inject(ContextMenuContext, fallback);
  return computed(() => unref(context)?.anchor ?? null);
}

/**
 * The text highlights the open context menu is about, topmost first. Pass a set name to read
 * one set. `R` is your range type, so fields you added to your ranges come back typed on
 * `range`.
 *
 * For a right-click (`trigger: 'pointer'`), these are the marks under the pointer. For a
 * keyboard open (`trigger: 'keyboard'`, Shift+F10 or the Menu key), these are the marks whose
 * current range holds the caret: same paragraph, and the caret offset from `start` to
 * `start + length`, both ends included. For a range selection, the caret is its `head`. A
 * keyboard hit's `rect` is the mark's rectangle on the caret's line.
 *
 * A document change while the menu is open, such as a collaborator's edit, reads the marks
 * again, so `start` and `length` never describe text that moved. Text that moved away from
 * the pointer or the caret is no longer reported. Empty while the menu is closed, and when
 * the caret is on a page that is not painted.
 *
 * @example
 * ```ts
 * const hits = useContextMenuHighlights<MisspellingRange>('spelling');
 * // hits.value[0]?.range.suggestions
 * ```
 * @public
 */
export function useContextMenuHighlights<R extends HighlightRange = HighlightRange>(
  name?: string
): Readonly<ShallowRef<readonly HighlightHit<R>[]>> {
  const editorRef = useDocxEditor();
  const anchor = useContextMenuAnchor();
  const hits = shallowRef<readonly HighlightHit<R>[]>(
    readContextMenuHighlights<R>(null, null, name)
  );
  const stop = watch(
    [() => editorRef.value, anchor],
    ([editor, opened], _previous, onCleanup) => {
      const read = () => {
        hits.value = readContextMenuHighlights<R>(editor, opened, name);
      };
      read();
      if (!editor || !opened) return;
      // Read again after each document change while open: at once, for a change painted
      // before it reports, and a frame later, for a paint deferred under input pressure.
      const view = editorHostWindow(editor);
      let frame = 0;
      const off = editor.on('change', () => {
        read();
        if (frame === 0) {
          frame = view.requestAnimationFrame(() => {
            frame = 0;
            read();
          });
        }
      });
      onCleanup(() => {
        off();
        if (frame !== 0) view.cancelAnimationFrame(frame);
      });
    },
    { immediate: true }
  );
  scopeDispose(stop);
  return hits;
}
