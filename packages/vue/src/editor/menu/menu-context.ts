import { computed, inject, unref, type ComputedRef, type InjectionKey, type MaybeRef } from 'vue';
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
  /** Open the Paragraph dialog. Undefined when the host has not composed one. */
  readonly onParagraphDialog: (() => void) | undefined;
  readonly onReportIssue: (() => void) | undefined;
  readonly reportIssue: boolean | undefined;
}

export const MenuContext: InjectionKey<MaybeRef<MenuContextValue>> = Symbol('MenuContext');

const defaultMenuContext: MenuContextValue = {
  t: undefined,
  openMenu: null,
  setOpenMenu: () => {},
  activeMenu: null,
  onOpen: undefined,
  onSave: undefined,
  onPageSetup: undefined,
  onParagraphDialog: undefined,
  onReportIssue: undefined,
  reportIssue: undefined,
};

export function useMenuContext(): ComputedRef<MenuContextValue> {
  const value = inject(MenuContext, defaultMenuContext);
  return computed(() => unref(value) as MenuContextValue);
}

export function useMenuLabel() {
  const context = useMenuContext();
  const { t: catalogT } = useTranslation();
  return (key: string) => context.value.t?.(key) ?? catalogT(key as TranslationKey);
}
