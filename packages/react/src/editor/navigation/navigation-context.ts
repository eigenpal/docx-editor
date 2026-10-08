// The pane state one `DocxEditor.Navigation` shares with its parts.
//
// Parts read this rather than taking props, so a host can reorder, drop, or wrap any of
// them without threading state through its own tree — the same shape the toolbar's
// FontFamily and the hyperlink popover use.

import { createContext, useContext } from 'react';
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

export const NavigationContext = createContext<NavigationContextValue | null>(null);

/**
 * The enclosing pane's state. Throws outside a `DocxEditor.Navigation` — unlike the editor
 * context (whose `null` is a real frame every consumer renders through), a part rendered
 * outside its compound root is a composition mistake with no sensible fallback.
 */
export function useNavigationContext(part: string): NavigationContextValue {
  const value = useContext(NavigationContext);
  if (!value) {
    throw new Error(
      `<DocxEditor.Navigation.${part}> must be rendered inside <DocxEditor.Navigation>`
    );
  }
  return value;
}
