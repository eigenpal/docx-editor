import { inject, unref, type InjectionKey } from 'vue';
import type { UseNavigationPaneResult } from './useNavigationPane';
import type { UseDocumentOutlineResult } from './useDocumentOutline';
import type { UseDocumentSearchResult } from './useDocumentSearch';

export interface NavigationContextValue {
  readonly pane: UseNavigationPaneResult;
  readonly outline: UseDocumentOutlineResult;
  readonly search: UseDocumentSearchResult;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  /**
   * Focus-aware intents the packaged parts use instead of `pane.setOpen`, so opening moves
   * focus into the pane and closing returns it to whatever opened the pane.
   */
  readonly intents: NavigationIntents;
  /** Whether Ctrl/Cmd+F opens this pane, so the disc names the shortcut only when it works. */
  readonly findShortcut: boolean;
}

/** What the packaged parts ask of the pane, beyond its plain state. */
export interface NavigationIntents {
  /** The disc: open the pane and focus its entry, or close it if it is open. */
  readonly toggle: () => void;
  /** The close arrow and Escape: close the pane and return focus to its opener. */
  readonly close: () => void;
  /** A heading or result was chosen. Closes an overlaying pane; a docked one stays open. */
  readonly picked: () => void;
}

export const NavigationContext: InjectionKey<NavigationContextValue | null> =
  Symbol('NavigationContext');

export function useNavigationContext(part: string): NavigationContextValue {
  const value = inject(NavigationContext, null);
  if (!value) {
    throw new Error(
      `<DocxEditor.Navigation.${part}> must be rendered inside <DocxEditor.Navigation>`
    );
  }
  return unref(value) as NavigationContextValue;
}

/**
 * The enclosing pane's state as a LIVE view: every read goes through the provided
 * computed, so a part that reads it inside its render function follows prop changes on
 * the pane (its `t`, its `findShortcut`) without remounting. Destructuring it at setup
 * gives the same snapshot `useNavigationContext` does.
 */
export function useLiveNavigationContext(part: string): NavigationContextValue {
  const value = inject(NavigationContext, null);
  if (!value) {
    throw new Error(
      `<DocxEditor.Navigation.${part}> must be rendered inside <DocxEditor.Navigation>`
    );
  }
  const current = () => unref(value) as NavigationContextValue;
  return {
    get pane() {
      return current().pane;
    },
    get outline() {
      return current().outline;
    },
    get search() {
      return current().search;
    },
    get t() {
      return current().t;
    },
    get intents() {
      return current().intents;
    },
    get findShortcut() {
      return current().findShortcut;
    },
  };
}
