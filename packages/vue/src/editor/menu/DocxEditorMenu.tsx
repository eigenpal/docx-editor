import { editorInstanceScope } from '@docx-editor.dev/core/editor';
import { DocxEditorExportDialog } from '../DocxEditorExportDialog';
import { DocxEditorPrintDialog } from '../DocxEditorPrintDialog';
import { usePopupConfig } from '../popup-config';
import { renderPopup } from '../popup-renderer';
import { useMenuExport } from './useMenuExport';
import { useMenuPrint } from './useMenuPrint';
import type { ChromeExportHandlers } from '@docx-editor.dev/core/editor';
import { DialogPortal, useDialogHost } from '../dialog-host';
import {
  computed,
  defineComponent,
  Fragment,
  h,
  provide,
  ref,
  shallowRef,
  watch,
  type Component,
  type PropType,
  type VNode,
} from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import {
  CHROME_MENUS,
  isChromePrintShortcut,
  type ChromeMenuId,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation, type TranslationKey } from '../../i18n';
import { DocxEditorPageSetupDialog } from '../DocxEditorPageSetup';
import { DocxEditorParagraphDialog } from '../DocxEditorParagraphDialog';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import { chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { MORE_PATHS } from '../toolbar/ToolbarOverflow';
import { FIXED_ATTRIBUTE, useToolbarOverflow } from '../toolbar/useToolbarOverflow';
import {
  MENU_OVERFLOW_ID,
  MenuContext,
  MenuOverflowContext,
  MenuOverflowScope,
  type MenuContextValue,
  type MenuId,
} from './menu-context';
import { download, downloadName } from './download';
import { barTriggers, restoreExportFocus } from './menu-keyboard';
import { flattenChildren } from '../../lib/flattenChildren';
import {
  Menu,
  MenuEntry,
  MenuFile,
  MenuFormat,
  MenuImageInsert,
  MenuInsert,
  MenuItem,
  MenuOpen,
  MenuPageSetup,
  MenuRow,
  MenuSave,
  MenuExportMarkdown,
  MenuExportPdf,
  MenuPrint,
  MenuGroup,
  MenuSeparator,
  MenuSubmenu,
  MenuTableGrid,
  type MenuPartComponent,
} from './parts';
import { MenuHelp, MenuReportIssue } from './menu-help';
import { useScopeClassName } from '../scope-context';
import { MenuReview, MenuReviewers } from './Reviewers';
import { usePopupEscape } from '../toolbar/usePopupEscape';

const MENU_PARTS: Record<ChromeMenuId, Component> = {
  file: MenuFile,
  format: MenuFormat,
  insert: MenuInsert,
  review: MenuReview,
  help: MenuHelp,
};

/** @public */
export interface DocxEditorMenuProps {
  /**
   * Converter handlers. Markdown requires docx-to-markdown; PDF requires docx-to-pdf on Node.js.
   * File > Print also uses the PDF handler. Missing handlers show an error.
   */
  exporters?: ChromeExportHandlers;
  className?: string;
  t?: ToolbarTranslate;
  fileName?: string;
  onOpen?: () => void;
  onOpenFile?: (file: File) => void;
  onSave?: () => void;
  /** Owns Page Setup opening when `popups.pageSetup` is omitted. Use `popups` to customize its UI. */
  onPageSetup?: () => void;
  onReportIssue?: () => void;
  reportIssue?: boolean;
  preset?: boolean;
  /**
   * What the bar does when its menus do not fit on one line. Default `true`: the bar stays
   * one line, measures its menus, and moves the ones that do not fit, from the end, into
   * one "⋯" menu, where each becomes a submenu with the same rows. `false` lets the bar
   * wrap onto more lines instead.
   *
   * The bar must be able to shrink for this to work, so give it a bounded width (for
   * example `min-width: 0` in a flex row). Host children that are not menus never move.
   *
   * @example
   * ```vue
   * <DocxEditorMenu :overflow="false" />
   * ```
   */
  overflow?: boolean;
  children?: DocxEditorChildren;
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

/**
 * The id of any menu vnode, registry or host: a pinned part's `docxMenu`, or the generic
 * `Menu`'s `id` prop. Null for anything that is not a menu, and for a hidden menu unless
 * `includeHidden` is set.
 */
function anyMenuIdOfChild(child: unknown, includeHidden = false): string | null {
  if (!isVNodeElement(child)) return null;
  if (child.type === Fragment) {
    const inner = flattenChildren((child.children ?? []) as VNode[]);
    const ids = inner
      .map((node) => anyMenuIdOfChild(node, includeHidden))
      .filter((id): id is string => id !== null);
    return ids.length === 1 ? ids[0]! : null;
  }
  const props = (child.props ?? {}) as { id?: unknown; hidden?: unknown };
  if ((props.hidden === true || props.hidden === '') && !includeHidden) return null;
  const type = child.type as { docxMenu?: unknown };
  if ((typeof type === 'function' || typeof type === 'object') && typeof type.docxMenu === 'string')
    return type.docxMenu;
  if (child.type === Menu && typeof props.id === 'string') return props.id;
  return null;
}

const selectOpening = (snapshot: EditorSnapshot): boolean => snapshot.isOpening === true;

const DocxEditorMenuRoot = defineComponent({
  name: 'DocxEditorMenu',
  props: {
    className: { type: String, default: undefined },
    t: { type: Function as PropType<ToolbarTranslate>, default: undefined },
    exporters: { type: Object as PropType<ChromeExportHandlers>, default: undefined },
    fileName: { type: String, default: undefined },
    onOpen: { type: Function as PropType<() => void>, default: undefined },
    /** Prefer over {@link onOpen} — Vue TSX treats `onOpen` as a listener. */
    openHandler: { type: Function as PropType<() => void>, default: undefined },
    onOpenFile: { type: Function as PropType<(file: File) => void>, default: undefined },
    onSave: { type: Function as PropType<() => void>, default: undefined },
    /** Prefer over {@link onSave} — Vue TSX treats `onSave` as a listener. */
    saveHandler: { type: Function as PropType<() => void>, default: undefined },
    onPageSetup: { type: Function as PropType<() => void>, default: undefined },
    onReportIssue: { type: Function as PropType<() => void>, default: undefined },
    reportIssue: { type: Boolean, default: undefined },
    preset: { type: Boolean, default: true },
    overflow: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const dialogs = useDialogHost();
    const popups = usePopupConfig();
    const scopeClassName = useScopeClassName();
    const editorRef = useDocxEditor();
    const { t: catalogT } = useTranslation();
    const openMenu = ref<MenuId | null>(null);
    // The previous document stays mounted while the next one opens; no menu acts on it.
    const opening = useEditorState(selectOpening);
    watch(opening, (now) => {
      if (now) openMenu.value = null;
    });
    const openedName = ref<string | null>(null);
    const exportState = useMenuExport(
      editorRef,
      () => props.exporters,
      () => props.fileName ?? openedName.value ?? undefined
    );
    const printState = useMenuPrint(
      editorRef,
      () => props.exporters,
      () => popups.value?.print !== false
    );
    const activeMenu = ref<MenuId | null>(null);
    const pageSetupOpen = ref(false);
    const paragraphDialogOpen = ref(false);
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
      document.addEventListener('mousedown', onPointerDown);
      onCleanup(() => {
        document.removeEventListener('mousedown', onPointerDown);
      });
    });
    // Escape from outside the bar, such as the pages, goes through the shared rule, and a
    // host input keeps its own Escape. Keys inside the bar stay with the menus' handlers.
    usePopupEscape(
      () => openMenu.value !== null,
      rootRef,
      () => {
        openMenu.value = null;
      },
      (event) => event.target instanceof Node && rootRef.value?.contains(event.target) === true
    );

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
      if (dialogs)
        dialogs.open(
          'pageSetup',
          rootRef.value?.querySelector<HTMLElement>('[data-menu="file"] .docx-menubar__trigger')
        );
      else pageSetupOpen.value = true;
    };

    // Use the Root coordinator when available; standalone menus retain a local host.
    const packagedParagraphDialog = () => {
      if (dialogs)
        dialogs.open(
          'paragraph',
          rootRef.value?.querySelector<HTMLElement>('[data-menu="format"] .docx-menubar__trigger')
        );
      else paragraphDialogOpen.value = true;
    };

    const resolvedOpen = computed(() =>
      editorRef.value ? (props.openHandler ?? props.onOpen ?? packagedOpen) : undefined
    );
    const resolvedSave = computed(() =>
      editorRef.value ? (props.saveHandler ?? props.onSave ?? packagedSave) : undefined
    );
    // Unavailable while a print session is open, so the row and Ctrl+P cannot start a second.
    const resolvedPrint = computed(() =>
      editorRef.value && !printState.active.value
        ? () => {
            restoreExportFocus(rootRef.value);
            // The frame goes inside the editor, so a host's modal dialog does not make it inert.
            void printState.execute(
              editorInstanceScope(rootRef.value) ?? rootRef.value ?? undefined
            );
          }
        : undefined
    );
    const resolvedPageSetup = computed(() =>
      editorRef.value
        ? dialogs?.ownsPageSetup
          ? packagedPageSetup
          : (props.onPageSetup ?? packagedPageSetup)
        : undefined
    );

    watch(
      () => [resolvedOpen.value, resolvedSave.value, resolvedPrint.value] as const,
      ([openFn, saveFn, printFn], _, onCleanup) => {
        // Immediate watchers also run during server rendering, where there is no document.
        if (typeof document === 'undefined') return;
        const onKeyDown = (event: KeyboardEvent) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
          const key = event.key.toLowerCase();
          const print = isChromePrintShortcut(event);
          if (key !== 's' && key !== 'o' && !print) return;
          const target = event.target as Node | null;
          const scope = editorInstanceScope(rootRef.value) ?? rootRef.value;
          const root = rootRef.value;
          if (!target) return;
          const inScope = (scope?.contains(target) ?? false) || (root?.contains(target) ?? false);
          if (!inScope) return;
          if (print) {
            // Checked first: on some layouts the P key types a character other than "p".
            // The shortcut stays with the browser when no PDF handler is configured. It is
            // also claimed while the print popup shows, so the browser does not print the
            // editor page under it.
            if (!props.exporters?.pdf || !editorRef.value) return;
            // A busy session without a visible popup leaves the key to the browser.
            if (!printFn && !(printState.visible.value && popups.value?.print !== false)) return;
            event.preventDefault();
            printFn?.();
          } else if (key === 's' && saveFn) {
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
      // Immediate: an editor that is ready before the menu mounts changes none of the
      // handlers, so a lazy watch would never bind the shortcuts.
      { flush: 'post', immediate: true }
    );

    const context = computed<MenuContextValue>(() => ({
      t: props.t,
      openMenu: openMenu.value,
      setOpenMenu: openMenuAndFocus,
      activeMenu: activeMenu.value,
      onOpen: resolvedOpen.value,
      onSave: resolvedSave.value,
      onExport:
        editorRef.value && !exportState.pending.value
          ? (format) => {
              restoreExportFocus(rootRef.value);
              return exportState.execute(format);
            }
          : undefined,
      onPrint: resolvedPrint.value,
      printShortcut: !!props.exporters?.pdf,
      onPageSetup: resolvedPageSetup.value,
      onParagraphDialog: editorRef.value ? packagedParagraphDialog : undefined,
      onReportIssue: props.onReportIssue,
      reportIssue: props.reportIssue,
      opening: opening.value,
    }));

    provide(MenuContext, context);

    // Which menus exist depends on the children, which Vue only renders inside `render`. The
    // render writes the answer here and the measuring hook reads it after the render.
    const layout = shallowRef<{ ids: readonly string[]; order: readonly string[] }>({
      ids: [],
      order: [],
    });
    const { attach, overflow } = useToolbarOverflow(
      () => props.overflow,
      () => layout.value.ids,
      () => layout.value.order
    );
    provide(
      MenuOverflowContext,
      computed(() => ({ measuring: props.overflow, overflow: overflow.value, inMore: false }))
    );

    const setRootRef = (node: HTMLDivElement | null) => {
      rootRef.value = node;
      attach(node);
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
      const kids = flattenChildren(slots.default?.() ?? []);
      // The menus in bar order, which is also what can move into the "⋯" menu.
      const menuIds: string[] = [];
      if (props.preset !== false) {
        const replaced = new Map(kids.map((child) => [menuOfChild(child), child] as const));
        for (const menu of CHROME_MENUS) {
          const override = replaced.get(menu.id);
          if (override === undefined || anyMenuIdOfChild(override) !== null) menuIds.push(menu.id);
        }
        for (const child of kids) {
          if (menuOfChild(child) !== null) continue;
          const id = anyMenuIdOfChild(child);
          if (id !== null) menuIds.push(id);
        }
      } else {
        for (const child of kids) {
          const id = anyMenuIdOfChild(child);
          if (id !== null) menuIds.push(id);
        }
      }
      // The end of the bar leaves first: Help, then Review, and so on toward File.
      const order = [...menuIds].reverse();
      if (layout.value.ids.join('\u0000') !== menuIds.join('\u0000')) {
        layout.value = { ids: menuIds, order };
      }
      // Host children that are not menus stay in the bar at every width. They are wrapped so
      // the fit counts their width, and they never render a second time inside "⋯".
      const isMenu = (child: VNode) => anyMenuIdOfChild(child, true) !== null;
      const hostBlock = (nodes: VNode[], key: string) =>
        h('div', { key, role: 'none', class: 'docx-menubar__host', [FIXED_ATTRIBUTE]: '' }, nodes);
      // `menus` is what the "⋯" menu renders: menus only, never host children.
      let menus: VNode[];
      if (props.preset === false) {
        menus = kids.filter(isMenu);
        // Wrapped only while the bar measures: a wrapping bar renders the host's markup as is.
        content = !slots.default
          ? undefined
          : props.overflow
            ? kids.map((child, index) =>
                isMenu(child) ? child : hostBlock([child], `host-${index}`)
              )
            : kids;
      } else {
        const overrides = new Map<ChromeMenuId, VNode>();
        const appended: VNode[] = [];
        for (const child of kids) {
          const id = menuOfChild(child);
          if (id) overrides.set(id, child);
          else appended.push(child);
        }
        menus = [
          ...CHROME_MENUS.flatMap((menu) => {
            const override = overrides.get(menu.id);
            if (override) return [h(Fragment, { key: menu.id }, [override])];
            const Part = MENU_PARTS[menu.id];
            return [h(Part, { key: menu.id })];
          }),
          ...appended.filter(isMenu),
        ];
        const hosts = appended.filter((child) => !isMenu(child));
        content = [...menus, ...(hosts.length > 0 ? [hostBlock(hosts, 'host')] : [])];
      }

      return (
        <>
          <div
            ref={setRootRef as never}
            role="menubar"
            aria-label={
              props.t?.('titleBar.menuBarAriaLabel') ??
              catalogT('titleBar.menuBarAriaLabel' as TranslationKey)
            }
            data-testid="docx-menubar"
            // One line when the bar measures itself; the stylesheet reads this.
            {...(props.overflow ? { 'data-overflow': '' } : {})}
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
            {overflow.value.size > 0 ? (
              <Menu
                id={MENU_OVERFLOW_ID}
                label={
                  props.t?.('formattingBar.more') ??
                  catalogT('formattingBar.more' as TranslationKey)
                }
                icon={chromeIcon(MORE_PATHS) as VNode}
                preset={false}
              >
                {{
                  default: () => <MenuOverflowScope>{{ default: () => menus }}</MenuOverflowScope>,
                }}
              </Menu>
            ) : null}
          </div>
          <DialogPortal
            content={() =>
              exportState.visible.value && popups.value?.export !== false ? (
                popups.value?.export ? (
                  renderPopup(
                    popups.value.export,
                    {
                      open: true,
                      format: exportState.format.value,
                      pending: exportState.pending.value,
                      error: exportState.error.value,
                      onClose: exportState.dismiss,
                    },
                    exportState.session.value
                  )
                ) : (
                  <DocxEditorExportDialog
                    open
                    format={exportState.format.value}
                    pending={exportState.pending.value}
                    error={exportState.error.value}
                    onClose={exportState.dismiss}
                  />
                )
              ) : null
            }
          />
          <DialogPortal
            content={() =>
              printState.visible.value && popups.value?.print !== false ? (
                popups.value?.print ? (
                  renderPopup(
                    popups.value.print,
                    {
                      open: true,
                      pending: printState.pending.value,
                      error: printState.error.value,
                      url: printState.url.value,
                      onClose: printState.close,
                    },
                    printState.session.value
                  )
                ) : (
                  <DocxEditorPrintDialog
                    open
                    pending={printState.pending.value}
                    error={printState.error.value}
                    url={printState.url.value}
                    onClose={printState.close}
                  />
                )
              ) : null
            }
          />
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
          <DocxEditorParagraphDialog
            open={paragraphDialogOpen.value}
            onClose={() => {
              paragraphDialogOpen.value = false;
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
  readonly Review: typeof MenuReview;
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
  readonly ExportMarkdown: typeof MenuExportMarkdown;
  readonly ExportPdf: typeof MenuExportPdf;
  readonly Print: typeof MenuPrint;
  readonly PageSetup: typeof MenuPageSetup;
  readonly ImageInsert: typeof MenuImageInsert;
  readonly Reviewers: typeof MenuReviewers;
  readonly ReportIssue: typeof MenuReportIssue;
}

/** @public */
export const DocxEditorMenu = Object.assign(DocxEditorMenuRoot, {
  Menu,
  File: MenuFile,
  Format: MenuFormat,
  Insert: MenuInsert,
  Review: MenuReview,
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
  ExportMarkdown: MenuExportMarkdown,
  ExportPdf: MenuExportPdf,
  Print: MenuPrint,
  PageSetup: MenuPageSetup,
  ImageInsert: MenuImageInsert,
  Reviewers: MenuReviewers,
  ReportIssue: MenuReportIssue,
}) as unknown as DocxEditorMenuNamespace;
