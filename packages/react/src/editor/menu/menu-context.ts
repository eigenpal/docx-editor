// Menu-scoped context: the translate function and the three host actions the menu bar's
// File rows need, published by the root to its parts.
//
// Open, save and page setup are the rows whose dispatch is NOT an engine command — bytes
// and dialog values cross the host boundary — so the root resolves each to a single
// handler (host override, else the packaged default) and the rows only call it. A row
// never decides policy; it renders what the context gives it.
//
// Like the toolbar context, no user-facing English lives here: labels are i18n keys from
// the chrome registry, resolved through the host's `t` or falling back to the KEY.

import { createContext, useContext } from 'react';
import type { ChromeMenuId } from '@docx-editor.dev/core-contract/editor';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';

export interface MenuContextValue {
  readonly t: ToolbarTranslate | undefined;
  /** Which menu is open, or null. Owned by the root so only one panel shows at a time. */
  readonly openMenu: ChromeMenuId | null;
  readonly setOpenMenu: (id: ChromeMenuId | null) => void;
  /** Resolved File-row actions; absent renders the row disabled. */
  readonly onOpen: (() => void) | undefined;
  readonly onSave: (() => void) | undefined;
  readonly onPageSetup: (() => void) | undefined;
  /** Replaces the packaged Help row's handler. */
  readonly onReportIssue: (() => void) | undefined;
  /** `false` drops the packaged Help row, and Help with it. */
  readonly reportIssue: boolean | undefined;
}

export const MenuContext = createContext<MenuContextValue>({
  t: undefined,
  openMenu: null,
  setOpenMenu: () => {},
  onOpen: undefined,
  onSave: undefined,
  onPageSetup: undefined,
  onReportIssue: undefined,
  reportIssue: undefined,
});

export function useMenuContext(): MenuContextValue {
  return useContext(MenuContext);
}

/** The label for an i18n key: the host's translation, or the key itself. */
export function useMenuLabel(): (key: string) => string {
  const { t } = useMenuContext();
  return (key: string) => t?.(key) ?? key;
}
