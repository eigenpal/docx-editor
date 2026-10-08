import type { ChromeExportFormat } from '@docx-editor.dev/core/editor';
import {
  computed,
  defineComponent,
  inject,
  provide,
  unref,
  type ComputedRef,
  type InjectionKey,
  type MaybeRef,
} from 'vue';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { ChromeMenuId } from '@docx-editor.dev/core/editor';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';

/** @public */
export type MenuId = ChromeMenuId | (string & {});

export interface MenuContextValue {
  readonly onExport?: (format: ChromeExportFormat) => void;
  readonly onPrint?: () => void;
  /** Whether the print row shows its shortcut: the editor handles it only with a PDF handler. */
  readonly printShortcut?: boolean;
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

/** The id of the "⋯" menu that holds the menus that do not fit. */
export const MENU_OVERFLOW_ID = 'docx-menubar-more';

/** Which menus moved into the "⋯" menu, and where the reading component renders. */
export interface MenuOverflowValue {
  /** Whether the bar measures its menus. Menus then mark themselves as collapsible. */
  readonly measuring: boolean;
  /** Ids of the menus that render inside the "⋯" menu instead of the bar. */
  readonly overflow: ReadonlySet<string>;
  /** True inside the "⋯" menu's panel, where a menu renders as a submenu row. */
  readonly inMore: boolean;
}

export const MenuOverflowContext: InjectionKey<ComputedRef<MenuOverflowValue>> =
  Symbol('MenuOverflowContext');

const NO_OVERFLOW: MenuOverflowValue = {
  measuring: false,
  overflow: new Set<string>(),
  inMore: false,
};

export function useMenuOverflow(): ComputedRef<MenuOverflowValue> {
  const value = inject(MenuOverflowContext, null);
  return computed(() => value?.value ?? NO_OVERFLOW);
}

/** Renders its children as the "⋯" menu's content: collapsed menus become submenus. */
export const MenuOverflowScope = defineComponent({
  name: 'MenuOverflowScope',
  setup(_, { slots }) {
    const parent = useMenuOverflow();
    provide(
      MenuOverflowContext,
      computed(() => ({ ...parent.value, measuring: false, inMore: true }))
    );
    return () => slots.default?.();
  },
});
