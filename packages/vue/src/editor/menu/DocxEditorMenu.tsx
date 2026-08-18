import {
  computed,
  defineComponent,
  Fragment,
  h,
  provide,
  ref,
  watch,
  type PropType,
  type VNode,
} from 'vue';
import { CHROME_MENUS, type ChromeMenuId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { editorScopeFor } from '../editor-scope';
import { useTranslation, type TranslationKey } from '../../i18n';
import { DocxEditorPageSetupDialog } from '../DocxEditorPageSetup';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import { guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { MenuContext, type MenuContextValue, type MenuId } from './menu-context';
import { download, downloadName } from './download';
import { barTriggers } from './menu-keyboard';
import { flattenChildren } from '../../lib/flattenChildren';
import {
  Menu,
  MenuEntry,
  MenuFile,
  MenuFormat,
  MenuHelp,
  MenuInsert,
  MenuItem,
  MenuOpen,
  MenuPageSetup,
  MenuRow,
  MenuSave,
  MenuGroup,
  MenuSeparator,
  MenuReportIssue,
  MenuSubmenu,
  MenuTableGrid,
  type MenuPartComponent,
} from './parts';
import { useScopeClassName } from '../scope-context';

const MENU_PARTS: Record<ChromeMenuId, MenuPartComponent> = {
  file: MenuFile,
  format: MenuFormat,
  insert: MenuInsert,
  help: MenuHelp,
};

/** @public */
export interface DocxEditorMenuProps {
  className?: string;
  t?: ToolbarTranslate;
  fileName?: string;
  onOpen?: () => void;
  onOpenFile?: (file: File) => void;
  onSave?: () => void;
  onPageSetup?: () => void;
  onReportIssue?: () => void;
  reportIssue?: boolean;
  preset?: boolean;
}

const MENU_IDS = new Set<string>(CHROME_MENUS.map((menu) => menu.id));

function isVNodeElement(value: unknown): value is VNode {
  return value != null && typeof value === 'object' && 'type' in (value as object);
}

function menuOfChild(child: unknown): ChromeMenuId | null {
  if (!isVNodeElement(child)) return null;
  if (child.type === Fragment) {
    const inner = flattenChildren((child.children ?? []) as VNode[]);
    const ids = inner.map(menuOfChild).filter((id): id is ChromeMenuId => id !== null);
    return ids.length === 1 ? ids[0]! : null;
  }
  const type = child.type as { docxMenu?: unknown };
  if (typeof type === 'function' || typeof type === 'object') {
    if (typeof type.docxMenu === 'string') return type.docxMenu as ChromeMenuId;
  }
  if (child.type === Menu) {
    const id = (child.props as { id?: unknown })?.id;
    if (typeof id === 'string' && MENU_IDS.has(id)) return id as ChromeMenuId;
  }
  return null;
}

const DocxEditorMenuRoot = defineComponent({
  name: 'DocxEditorMenu',
  props: {
    className: { type: String, default: undefined },
    t: { type: Function as PropType<ToolbarTranslate>, default: undefined },
    fileName: { type: String, default: undefined },
    onOpen: { type: Function as PropType<() => void>, default: undefined },
    onOpenFile: { type: Function as PropType<(file: File) => void>, default: undefined },
    onSave: { type: Function as PropType<() => void>, default: undefined },
    onPageSetup: { type: Function as PropType<() => void>, default: undefined },
    onReportIssue: { type: Function as PropType<() => void>, default: undefined },
    reportIssue: { type: Boolean, default: undefined },
    preset: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const scopeClassName = useScopeClassName();
    const editorRef = useDocxEditor();
    const { t: catalogT } = useTranslation();
    const openMenu = ref<MenuId | null>(null);
    const openedName = ref<string | null>(null);
    const activeMenu = ref<MenuId | null>(null);
    const pageSetupOpen = ref(false);
    const rootRef = ref<HTMLDivElement | null>(null);
    const fileInputRef = ref<HTMLInputElement | null>(null);

    const openMenuAndFocus = (id: MenuId | null) => {
      openMenu.value = id;
      if (id !== null) activeMenu.value = id;
    };

    watch(openMenu, (current, _, onCleanup) => {
      if (current === null) return;
      const onPointerDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        openMenu.value = null;
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') openMenu.value = null;
      };
      document.addEventListener('mousedown', onPointerDown);
      document.addEventListener('keydown', onKeyDown);
      onCleanup(() => {
        document.removeEventListener('mousedown', onPointerDown);
        document.removeEventListener('keydown', onKeyDown);
      });
    });

    const packagedOpen = () => fileInputRef.value?.click();

    const packagedSave = () => {
      const editor = editorRef.value;
      if (!editor) return;
      void editor
        .save()
        .then((buffer) =>
          download(buffer, downloadName(props.fileName ?? openedName.value ?? undefined))
        )
        .catch((error: unknown) => {
          console.error('[docx-editor] save failed', error);
        });
    };

    const packagedPageSetup = () => {
      pageSetupOpen.value = true;
    };

    const resolvedOpen = computed(() =>
      editorRef.value ? (props.onOpen ?? packagedOpen) : undefined
    );
    const resolvedSave = computed(() =>
      editorRef.value ? (props.onSave ?? packagedSave) : undefined
    );
    const resolvedPageSetup = computed(() =>
      editorRef.value ? (props.onPageSetup ?? packagedPageSetup) : undefined
    );

    watch(
      [resolvedOpen, resolvedSave],
      ([openFn, saveFn], _, onCleanup) => {
        const onKeyDown = (event: KeyboardEvent) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
          const key = event.key.toLowerCase();
          if (key !== 's' && key !== 'o') return;
          const target = event.target as Node | null;
          const scope = editorScopeFor(rootRef.value) ?? rootRef.value;
          if (!target || !scope?.contains(target)) return;
          if (key === 's' && saveFn) {
            event.preventDefault();
            saveFn();
          } else if (key === 'o' && openFn) {
            event.preventDefault();
            openFn();
          }
        };
        document.addEventListener('keydown', onKeyDown);
        onCleanup(() => document.removeEventListener('keydown', onKeyDown));
      },
      { flush: 'post' }
    );

    const context = computed<MenuContextValue>(() => ({
      t: props.t,
      openMenu: openMenu.value,
      setOpenMenu: openMenuAndFocus,
      activeMenu: activeMenu.value,
      onOpen: resolvedOpen.value,
      onSave: resolvedSave.value,
      onPageSetup: resolvedPageSetup.value,
      onReportIssue: props.onReportIssue,
      reportIssue: props.reportIssue,
    }));

    provide(MenuContext, context);

    const setRootRef = (node: HTMLDivElement | null) => {
      rootRef.value = node;
      if (node && activeMenu.value === null) {
        const first = barTriggers(node)[0]?.closest('[data-menu]')?.getAttribute('data-menu');
        if (first) activeMenu.value = first;
      }
    };

    const onFileChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      const editor = editorRef.value;
      if (!file || !editor) return;
      openedName.value = file.name;
      props.onOpenFile?.(file);
      void file
        .arrayBuffer()
        .then((buffer) => editor.load(new Uint8Array(buffer)))
        .catch((error: unknown) => {
          console.error('[docx-editor] could not open the file', error);
        });
    };

    return () => {
      let content: VNode[] | undefined;
      if (props.preset === false) {
        content = slots.default ? flattenChildren(slots.default()) : undefined;
      } else {
        const overrides = new Map<ChromeMenuId, VNode>();
        const appended: VNode[] = [];
        for (const child of flattenChildren(slots.default?.() ?? [])) {
          const id = menuOfChild(child);
          if (id) overrides.set(id, child);
          else appended.push(child);
        }
        content = [
          ...CHROME_MENUS.flatMap((menu) => {
            const override = overrides.get(menu.id);
            if (override) return [h(Fragment, { key: menu.id }, [override])];
            const Part = MENU_PARTS[menu.id];
            return [h(Part, { key: menu.id })];
          }),
          ...appended,
        ];
      }

      return (
        <>
          <div
            ref={setRootRef as never}
            role="menubar"
            aria-label={
              props.t?.('titleBar.menuBarAriaLabel') ??
              catalogT.value('titleBar.menuBarAriaLabel' as TranslationKey)
            }
            data-testid="docx-menubar"
            class={`${scopeClassName}docx-menubar${props.className ? ` ${props.className}` : ''}`}
            onMousedown={guardToolbarMousedown}
            onKeydown={(event: KeyboardEvent) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              const bar = rootRef.value;
              if (!bar) return;
              const triggers = barTriggers(bar);
              const index = triggers.indexOf(document.activeElement as HTMLElement);
              if (index === -1) return;
              event.preventDefault();
              const step = event.key === 'ArrowRight' ? 1 : -1;
              const next = triggers[(index + step + triggers.length) % triggers.length];
              const id = next?.closest('[data-menu]')?.getAttribute('data-menu');
              if (!id) return;
              activeMenu.value = id;
              next?.focus();
              if (openMenu.value !== null) openMenu.value = id;
            }}
          >
            {content}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: 'none' }}
            onChange={onFileChange}
          />
          <DocxEditorPageSetupDialog
            open={pageSetupOpen.value}
            onClose={() => {
              pageSetupOpen.value = false;
            }}
          />
        </>
      );
    };
  },
});

/** @public */
export interface DocxEditorMenuNamespace {
  (props: DocxEditorMenuProps): VNode;
  readonly Menu: typeof Menu;
  readonly File: MenuPartComponent;
  readonly Format: MenuPartComponent;
  readonly Insert: MenuPartComponent;
  readonly Help: MenuPartComponent;
  readonly Item: typeof MenuItem;
  readonly Row: typeof MenuRow;
  readonly Group: typeof MenuGroup;
  readonly Separator: typeof MenuSeparator;
  readonly Submenu: typeof MenuSubmenu;
  readonly TableGrid: typeof MenuTableGrid;
  readonly Entry: typeof MenuEntry;
  readonly Open: typeof MenuOpen;
  readonly Save: typeof MenuSave;
  readonly PageSetup: typeof MenuPageSetup;
  readonly ReportIssue: typeof MenuReportIssue;
}

/** @public */
export const DocxEditorMenu = Object.assign(DocxEditorMenuRoot, {
  Menu,
  File: MenuFile,
  Format: MenuFormat,
  Insert: MenuInsert,
  Help: MenuHelp,
  Item: MenuItem,
  Row: MenuRow,
  Group: MenuGroup,
  Separator: MenuSeparator,
  Submenu: MenuSubmenu,
  TableGrid: MenuTableGrid,
  Entry: MenuEntry,
  Open: MenuOpen,
  Save: MenuSave,
  PageSetup: MenuPageSetup,
  ReportIssue: MenuReportIssue,
}) as unknown as DocxEditorMenuNamespace;
