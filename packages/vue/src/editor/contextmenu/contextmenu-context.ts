import { computed, inject, unref, type ComputedRef, type InjectionKey, type MaybeRef } from 'vue';

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
