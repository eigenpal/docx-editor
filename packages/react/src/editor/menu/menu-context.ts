// Menu-scoped context: the translate function and the three host actions the menu bar's
// File rows need, published by the root to its parts.
//
// Open, save and page setup are the rows whose dispatch is NOT an engine command — bytes
// and dialog values cross the host boundary — so the root resolves each to a single
// handler (host override, else the packaged default) and the rows only call it. A row
// never decides policy; it renders what the context gives it.
//
// Like the toolbar context, no user-facing English lives here: labels are i18n keys from
// the chrome registry, resolved through the host's `t` or the active `LocaleContext`
// catalogue — the same default the packaged `<DocxEditor>` uses. The context menu's rows
// resolve through `useMenuLabel` too, so this one fallback covers both surfaces.

import { createContext, useContext } from 'react';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { ChromeMenuId } from '@docx-editor.dev/core/editor';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';

/**
 * A menu's identity: one of the registry's four, or a HOST'S OWN.
 *
 * The `(string & {})` arm keeps the registry ids as editor autocomplete while accepting
 * any other string, so a product can add "Review" or "Clauses" without the library having
 * to know about it. Lives here rather than in `parts` because the bar's open/active state
 * is keyed on it and both modules read that state.
 *
 * @public
 */
export type MenuId = ChromeMenuId | (string & {});

export interface MenuContextValue {
  readonly t: ToolbarTranslate | undefined;
  /** Which menu is open, or null. Owned by the root so only one panel shows at a time. */
  readonly openMenu: MenuId | null;
  readonly setOpenMenu: (id: MenuId | null) => void;
  /**
   * Which trigger holds the bar's single tab stop (the roving tabindex). Separate from
   * `openMenu` because the bar must be tabbable while CLOSED — otherwise a keyboard user
   * cannot reach it at all — and because arrowing along the bar moves the stop without
   * opening anything.
   */
  readonly activeMenu: MenuId | null;
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
  activeMenu: null,
  onOpen: undefined,
  onSave: undefined,
  onPageSetup: undefined,
  onReportIssue: undefined,
  reportIssue: undefined,
});

export function useMenuContext(): MenuContextValue {
  return useContext(MenuContext);
}

/** The label for an i18n key: the host's translation, else the locale catalogue. */
export function useMenuLabel(): (key: string) => string {
  const { t } = useMenuContext();
  const { t: catalogT } = useTranslation();
  return (key: string) => t?.(key) ?? catalogT(key as TranslationKey);
}
