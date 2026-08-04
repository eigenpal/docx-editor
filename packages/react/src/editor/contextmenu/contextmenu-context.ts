// Context-menu-scoped state: where the panel is, and how a row closes it.
//
// The rows themselves are the MENU BAR's rows — `MenuRow`, `MenuItem`, `MenuSubmenu`,
// `MenuSeparator` — reused verbatim, because a right-click row and a menu-bar row are the
// same object: icon column, label, shortcut column, `aria-disabled` with the engine's
// reason. Two implementations would be two places for the disabled treatment to drift.
//
// Those parts close their panel by calling `setOpenMenu(null)` from the MENU context, so
// the root publishes a `MenuContext` whose `setOpenMenu` closes THIS panel. That is the
// whole adapter between the two compounds, and it is why this context carries only what
// the menu context has no field for.

import { createContext, useContext } from 'react';

/** Where the panel opened, in client coordinates. */
export interface ContextMenuAnchor {
  readonly x: number;
  readonly y: number;
}

export interface ContextMenuContextValue {
  /** Close the panel and return focus to the document. */
  readonly close: () => void;
  /** Non-null exactly while the panel is open. */
  readonly anchor: ContextMenuAnchor | null;
}

export const ContextMenuContext = createContext<ContextMenuContextValue>({
  close: () => {},
  anchor: null,
});

export function useContextMenuContext(): ContextMenuContextValue {
  return useContext(ContextMenuContext);
}
