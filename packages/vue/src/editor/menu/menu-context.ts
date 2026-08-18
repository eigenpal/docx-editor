import { inject, type InjectionKey } from 'vue';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { ChromeMenuId } from '@docx-editor.dev/core/editor';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';

/** @public */
export type MenuId = ChromeMenuId | (string & {});

export interface MenuContextValue {
  readonly t: ToolbarTranslate | undefined;
  readonly openMenu: MenuId | null;
  readonly setOpenMenu: (id: MenuId | null) => void;
  readonly activeMenu: MenuId | null;
  readonly onOpen: (() => void) | undefined;
  readonly onSave: (() => void) | undefined;
  readonly onPageSetup: (() => void) | undefined;
  readonly onReportIssue: (() => void) | undefined;
  readonly reportIssue: boolean | undefined;
}

export const MenuContext: InjectionKey<MenuContextValue> = Symbol('MenuContext');

const defaultMenuContext: MenuContextValue = {
  t: undefined,
  openMenu: null,
  setOpenMenu: () => {},
  activeMenu: null,
  onOpen: undefined,
  onSave: undefined,
  onPageSetup: undefined,
  onReportIssue: undefined,
  reportIssue: undefined,
};

export function useMenuContext(): MenuContextValue {
  return inject(MenuContext, defaultMenuContext);
}

export function useMenuLabel() {
  const { t } = useMenuContext();
  const { t: catalogT } = useTranslation();
  return (key: string) => t?.(key) ?? catalogT.value(key as TranslationKey);
}
