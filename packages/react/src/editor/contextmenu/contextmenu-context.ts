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
  /**
   * Close the panel. `restoreFocus` on the paths where the user is FINISHING with the menu
   * (selecting a row); not on the ones where they are already going elsewhere.
   */
  readonly close: (restoreFocus?: boolean) => void;
  /** Non-null exactly while the panel is open. */
  readonly anchor: ContextMenuAnchor | null;
  /**
   * The table of contents this open was over, captured AT OPEN TIME.
   *
   * Read imperatively from the editor in the same event that opens the panel, not
   * subscribed to. The engine records the right-click target and the panel opens from the
   * same event, so a subscription is a render behind: the first right-click on a TOC drew
   * the menu without its rows and only a second one had them. It is also the more honest
   * shape — an open menu describes the gesture that opened it, whatever happens next.
   */
  readonly tocId: string | null;
  /**
   * The element the opening right-click landed on, captured AT OPEN TIME like {@link tocId}.
   *
   * What lets a contextual row decide it applies — a custom-node chip, a painted marker —
   * without installing a second `contextmenu` listener that could disagree with the one
   * that opened the panel. Null while closed, and for keyboard-invoked opens, which have
   * no pointer target.
   */
  readonly target: HTMLElement | null;
  /**
   * The browser's reason for refusing a clipboard READ, once one has actually been refused.
   *
   * Lives on the ROOT rather than in the Paste row because selecting that row closes the
   * panel, which unmounts the row — state kept there was written and discarded in the same
   * batch, so the row it was meant to disable came back enabled on the next right-click and
   * the documented behaviour never once happened. Firefox and Safari refuse every read, so
   * "ask once, then stop offering it" has to outlive one open.
   */
  readonly clipboardRefusal: string | null;
  readonly reportClipboardRefusal: (reason: string) => void;
}

export const ContextMenuContext = createContext<ContextMenuContextValue>({
  close: () => {},
  anchor: null,
  tocId: null,
  target: null,
  clipboardRefusal: null,
  reportClipboardRefusal: () => {},
});

export function useContextMenuContext(): ContextMenuContextValue {
  return useContext(ContextMenuContext);
}

/**
 * The element the opening right-click landed on, or null while the menu is closed.
 *
 * Public so capability packages can render contextual sections — a row that only exists
 * when the press landed on their own painted chrome — without a second listener.
 *
 * @public
 */
export function useContextMenuTarget(): HTMLElement | null {
  return useContext(ContextMenuContext).target;
}
