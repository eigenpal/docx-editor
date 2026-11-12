import {
  computed,
  defineComponent,
  Fragment,
  h,
  nextTick,
  provide,
  ref,
  shallowRef,
  watch,
  watchEffect,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import {
  isHTMLElementNode,
  hostDocumentOf,
  hostWindowOf,
  chartPaneAvailable,
  openChartPaneFor,
  placeContextMenu,
  revealMenuItem,
  shapePaneAvailable,
  showInTopLayer,
} from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { useEditorState } from '../useEditorState';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { mergeArrangement } from '../merge-arrangement';
import { flattenChildren } from '../../lib/flattenChildren';
import { useDocxEditor, useEditorStateTick, useReviewRailRegistry } from '../context';
import { useAddCommentState } from '../toolbar/add-comment-state';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import {
  MenuContext,
  useMenuContext,
  useMenuLabel,
  type MenuContextValue,
} from '../menu/menu-context';
import { focusBy, focusEdge, panelItems } from '../menu/menu-keyboard';
import {
  MenuGroup,
  MenuItem,
  MenuRow,
  MenuSeparator,
  MenuSubmenu,
  menuItemSlotIdOfVNode,
} from '../menu/parts';
import { warnUnmatchedHiddenRow } from '../menu/menu-warnings';
import { contextMenuRowId } from './row-alias';
import {
  ContextMenuStart,
  StartPlacementRegion,
  startPlacedChild,
  warnPackagedRowsIn,
} from './start';
import { isDocumentContextMenuTarget } from './menu-target';
import { ContextMenuContext, type ContextMenuAnchor } from './contextmenu-context';
import {
  ContextMenuCopy,
  ContextMenuCopyFormatting,
  ContextMenuCellVerticalAlignment,
  ContextMenuCut,
  ContextMenuDelete,
  ContextMenuDeleteTable,
  ContextMenuDeleteTableColumn,
  ContextMenuDeleteTableRow,
  ContextMenuInsertColumnLeft,
  ContextMenuInsertColumnRight,
  ContextMenuMergeCells,
  ContextMenuSplitCell,
  ContextMenuSelectTable,
  ContextMenuInsertRowAbove,
  ContextMenuInsertRowBelow,
  ContextMenuItem,
  ContextMenuPaste,
  ContextMenuPasteFormatting,
  ContextMenuPasteWithoutFormatting,
  ContextMenuSelectAll,
  ContextMenuRefreshToc,
  ContextMenuRefreshTocPageNumbers,
  ContextMenuRemoveToc,
  useTableContextMenuVisible,
} from './parts';
import { useChromeScopeClassName } from '../color-mode-context';
import { MenuLinkRow } from '../menu/menu-link-row';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useChromeDir } from '../../i18n';

/** Where the measured panel sits, and the height past which it scrolls. */
type ContextMenuPlacement = ReturnType<typeof placeContextMenu>;

/** @public */
export interface DocxEditorContextMenuProps {
  className?: string;
  t?: ToolbarTranslate;
  preset?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: DocxEditorChildren;
}

type DefaultEntry =
  | { readonly kind: 'row'; readonly id: string; readonly render: () => DocxEditorChildren }
  | { readonly kind: 'separator'; readonly id: string };

const ContextMenuAddComment = defineComponent({
  name: 'ContextMenuAddComment',
  setup() {
    const rail = useReviewRailRegistry();
    const menu = useMenuContext();
    const label = useMenuLabel();
    // The same slot as `Toolbar.AddComment`, so enabled state and its reason have one
    // source: `toolbarCommandState`. The row needs a mounted review rail to open the draft,
    // so without one it is left out, whatever the engine answers.
    const { isEnabled, reason } = useAddCommentState(label);
    return () => {
      if (rail.value.mounted === 0) return null;
      const control = chromeControlForSlot('review.addComment');
      return (
        <MenuRow
          icon={chromeIcon(control?.paths) ?? undefined}
          {...{ rowSlot: 'review.addComment' }}
          disabled={!isEnabled.value}
          title={reason.value ?? undefined}
          selectHandler={() => {
            if (!rail.value.requestCommentDraft()) return;
            menu.value.setOpenMenu(null);
          }}
        >
          {{ default: () => label('comments.addComment') }}
        </MenuRow>
      );
    };
  },
});

const ContextMenuEditField = defineComponent({
  name: 'ContextMenuEditField',
  setup() {
    const editor = useDocxEditor();
    const menu = useMenuContext();
    const label = useMenuLabel();
    return () =>
      !editor.value?.can({ type: 'editTextFormField' }).ok ? null : (
        <MenuRow
          rowSlot="field.edit"
          onSelect={() => {
            menu.value.setOpenMenu(null);
            editor.value?.exec({ type: 'editTextFormField' });
          }}
        >
          {{ default: () => label('textFormField.edit') }}
        </MenuRow>
      );
  },
});

/** Edit chart, on a selected chart: opens the Chart pane, as a double press does. */
const ContextMenuEditChart = defineComponent({
  name: 'ContextMenuEditChart',
  setup() {
    const editor = useDocxEditor();
    const menu = useMenuContext();
    const label = useMenuLabel();
    const chartId = useEditorState((snapshot) => snapshot.chart?.drawingNodeId ?? null);
    return () => {
      const instance = editor.value;
      const id = chartId.value;
      if (!instance || !id || !chartPaneAvailable(instance)) return null;
      return (
        <MenuRow
          rowSlot="image.editChart"
          onSelect={() => {
            menu.value.setOpenMenu(null);
            openChartPaneFor(instance, id);
          }}
        >
          {{ default: () => label('chart.edit') }}
        </MenuRow>
      );
    };
  },
});

/** Format shape, on a selected shape, text box, line, or group: opens the Format shape pane. */
const ContextMenuFormatShape = defineComponent({
  name: 'ContextMenuFormatShape',
  setup() {
    const editor = useDocxEditor();
    const menu = useMenuContext();
    const label = useMenuLabel();
    const shapeId = useEditorState((snapshot) =>
      snapshot.image?.shapeFormat ? snapshot.image.id : null
    );
    // Enabled state and its reason come from the slot (`toolbarCommandState`), as on the toolbar.
    const command = useEditorCommand('image.formatShape');
    return () => {
      const instance = editor.value;
      const id = shapeId.value;
      if (!instance || !id || !shapePaneAvailable(instance)) return null;
      return (
        <MenuRow
          icon={chromeIcon(chromeControlForSlot('image.formatShape')?.paths) ?? undefined}
          rowSlot="image.formatShape"
          disabled={!command.isEnabled.value}
          {...(command.disabledReason.value ? { title: command.disabledReason.value } : {})}
          onSelect={() => {
            menu.value.setOpenMenu(null);
            command.execute();
          }}
        >
          {{ default: () => label('shape.formatShape') }}
        </MenuRow>
      );
    };
  },
});

const BASE_DEFAULT_SET: readonly DefaultEntry[] = [
  { kind: 'row', id: 'field.edit', render: () => <ContextMenuEditField /> },
  { kind: 'row', id: 'image.editChart', render: () => <ContextMenuEditChart /> },
  { kind: 'row', id: 'image.formatShape', render: () => <ContextMenuFormatShape /> },
  { kind: 'row', id: 'edit.cut', render: () => <ContextMenuCut /> },
  { kind: 'row', id: 'edit.copy', render: () => <ContextMenuCopy /> },
  { kind: 'row', id: 'edit.paste', render: () => <ContextMenuPaste /> },
  {
    kind: 'row',
    id: 'edit.pasteWithoutFormatting',
    render: () => <ContextMenuPasteWithoutFormatting />,
  },
  // The Format Painter's two halves, in the clipboard group where a reader looks for
  // "copy this, put it there". The toolbar's painter button is the same capability as one
  // armed gesture; these are the two steps taken apart, which is what a keyboard user and
  // a right-click user each want.
  { kind: 'row', id: 'format.copyFormatting', render: () => <ContextMenuCopyFormatting /> },
  { kind: 'row', id: 'format.pasteFormatting', render: () => <ContextMenuPasteFormatting /> },
  { kind: 'separator', id: 'sep.clipboard' },
  { kind: 'row', id: 'edit.delete', render: () => <ContextMenuDelete /> },
  { kind: 'row', id: 'edit.selectAll', render: () => <ContextMenuSelectAll /> },
  { kind: 'separator', id: 'sep.selection' },
  {
    kind: 'row',
    id: 'text.link',
    // The label switches to Edit link on an existing link; see `MenuLinkRow`.
    render: () => <MenuLinkRow shortcutKey="contextMenu.insertLinkShortcut" />,
  },
  {
    kind: 'row',
    id: 'review.addComment',
    render: () => <ContextMenuAddComment />,
  },
];

function tableContextEntries(): readonly DefaultEntry[] {
  return [
    { kind: 'separator', id: 'sep.table' },
    {
      kind: 'row',
      id: ContextMenuSelectTable.docxRow,
      render: () => <ContextMenuSelectTable />,
    },
    {
      kind: 'row',
      id: ContextMenuInsertRowAbove.docxRow,
      render: () => <ContextMenuInsertRowAbove />,
    },
    {
      kind: 'row',
      id: ContextMenuInsertRowBelow.docxRow,
      render: () => <ContextMenuInsertRowBelow />,
    },
    { kind: 'separator', id: 'sep.table.columns' },
    {
      kind: 'row',
      id: ContextMenuInsertColumnLeft.docxRow,
      render: () => <ContextMenuInsertColumnLeft />,
    },
    {
      kind: 'row',
      id: ContextMenuInsertColumnRight.docxRow,
      render: () => <ContextMenuInsertColumnRight />,
    },
    { kind: 'separator', id: 'sep.table.cells' },
    {
      kind: 'row',
      id: ContextMenuMergeCells.docxRow,
      render: () => <ContextMenuMergeCells />,
    },
    {
      kind: 'row',
      id: ContextMenuSplitCell.docxRow,
      render: () => <ContextMenuSplitCell />,
    },
    { kind: 'separator', id: 'sep.table.destructive' },
    {
      kind: 'row',
      id: ContextMenuDeleteTableRow.docxRow,
      render: () => <ContextMenuDeleteTableRow />,
    },
    {
      kind: 'row',
      id: ContextMenuDeleteTableColumn.docxRow,
      render: () => <ContextMenuDeleteTableColumn />,
    },
    { kind: 'row', id: ContextMenuDeleteTable.docxRow, render: () => <ContextMenuDeleteTable /> },
    { kind: 'separator', id: 'sep.table.alignment' },
    {
      kind: 'row',
      id: ContextMenuCellVerticalAlignment.docxRow,
      render: () => <ContextMenuCellVerticalAlignment />,
    },
  ];
}

function tocContextEntries(): readonly DefaultEntry[] {
  return [
    { kind: 'separator', id: 'sep.toc' },
    { kind: 'row', id: ContextMenuRefreshToc.docxRow, render: () => <ContextMenuRefreshToc /> },
    {
      kind: 'row',
      id: ContextMenuRefreshTocPageNumbers.docxRow,
      render: () => <ContextMenuRefreshTocPageNumbers />,
    },
    { kind: 'row', id: ContextMenuRemoveToc.docxRow, render: () => <ContextMenuRemoveToc /> },
  ];
}

/** @internal */
export function contextMenuDefaultSet(
  tableContextVisible: boolean,
  tocContextVisible = false
): readonly DefaultEntry[] {
  return [
    ...BASE_DEFAULT_SET,
    ...(tableContextVisible ? tableContextEntries() : []),
    ...(tocContextVisible ? tocContextEntries() : []),
  ];
}

function isVNodeElement(value: unknown): value is VNode {
  return value != null && typeof value === 'object' && 'type' in (value as object);
}

function rowOfChild(child: unknown): string | null {
  if (!isVNodeElement(child)) return null;
  if (child.type === Fragment) {
    const inner = flattenChildren((child.children ?? []) as VNode[]);
    const ids = inner.map(rowOfChild).filter((id): id is string => id !== null);
    return ids.length === 1 ? ids[0]! : null;
  }
  const type = child.type as { docxRow?: unknown; docxMenuRow?: unknown; docxSlot?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return null;
  if (typeof type.docxRow === 'string') return type.docxRow;
  if (typeof type.docxSlot === 'string') return type.docxSlot;
  if (type.docxMenuRow === true) {
    const slot = menuItemSlotIdOfVNode(child as VNode);
    if (slot) return slot;
  }
  return null;
}

function scrollerFor(anchor: HTMLElement | null): HTMLElement | null {
  return anchor?.closest<HTMLElement>('.docx-editor__scroll-container') ?? null;
}

/** @public */
export const DocxEditorContextMenu = defineComponent({
  name: 'DocxEditorContextMenu',
  props: {
    className: { type: String, default: undefined },
    t: { type: Function as PropType<ToolbarTranslate>, default: undefined },
    preset: { type: Boolean, default: true },
    disabled: { type: Boolean, default: undefined },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
  },
  setup(props, { slots }) {
    const scopeClassName = useChromeScopeClassName();
    const chromeDir = useChromeDir();
    const editorRef = useDocxEditor();
    const stateTick = useEditorStateTick();
    const { t: catalogT } = useTranslation();
    const tableContextVisible = useTableContextMenuVisible();
    const hostRef = ref<HTMLDivElement | null>(null);
    const panelRef = ref<HTMLDivElement | null>(null);
    const anchor = ref<ContextMenuAnchor | null>(null);
    const tocId = ref<string | null>(null);
    const target = ref<HTMLElement | null>(null);
    const placement = ref<ContextMenuPlacement | null>(null);
    const clipboardRefusal = ref<string | null>(null);
    const wasOpen = ref(false);
    const openChangeRef = shallowRef(props.onOpenChange);

    watch(
      () => props.onOpenChange,
      (next) => {
        openChangeRef.value = next;
      }
    );

    const defaultSet = computed(() =>
      contextMenuDefaultSet(tableContextVisible.value, tocId.value !== null)
    );

    const close = (restoreFocus = false) => {
      anchor.value = null;
      placement.value = null;
      tocId.value = null;
      target.value = null;
      if (restoreFocus) editorRef.value?.focus();
    };

    watch(
      () => props.disabled,
      (disabled) => {
        if (disabled) close();
      }
    );

    /** The scroller the open menu came from: its document and window own the menu. */
    let menuScroller: HTMLElement | null = null;
    watchEffect((onCleanup) => {
      void stateTick.value;
      if (props.disabled) return;
      const scroller =
        scrollerFor(hostRef.value) ??
        (hostRef.value
          ? hostDocumentOf(hostRef.value).querySelector<HTMLElement>(
              '.docx-editor__scroll-container'
            )
          : null);
      if (!scroller) return;
      const onContextMenu = (event: MouseEvent) => {
        // A second right-click on the open panel neither moves it nor shows the browser's menu.
        if (panelRef.value?.contains(event.target as Node | null)) {
          event.preventDefault();
          return;
        }
        // Chrome in the scroller, such as the link popover, keeps the browser's own menu.
        if (!isDocumentContextMenuTarget(scroller, event.target)) return;
        event.preventDefault();
        const keyboard = event.button === -1 || (event.clientX === 0 && event.clientY === 0);
        const box = scroller.getBoundingClientRect();
        menuScroller = scroller;
        tocId.value = editorRef.value?.snapshot().tocContext?.id ?? null;
        target.value = keyboard || !isHTMLElementNode(event.target) ? null : event.target;
        anchor.value = keyboard
          ? { x: box.left + 16, y: box.top + 16 }
          : { x: event.clientX, y: event.clientY };
      };
      scroller.addEventListener('contextmenu', onContextMenu);
      onCleanup(() => scroller.removeEventListener('contextmenu', onContextMenu));
    });

    watch(
      anchor,
      (current, _, onCleanup) => {
        if (!current) return;
        const onPointerDown = (event: PointerEvent) => {
          if (!panelRef.value?.contains(event.target as Node | null)) close();
        };
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
          } else if (event.key === 'Tab') {
            close();
          }
        };
        const onScroll = (event: Event) => {
          // The panel's own scroll, when a long menu scrolls inside, is not the user moving on.
          if (event.type === 'scroll' && panelRef.value?.contains(event.target as Node | null)) {
            return;
          }
          close();
        };
        const doc = hostDocumentOf(menuScroller ?? hostRef.value);
        const win = hostWindowOf(menuScroller ?? hostRef.value);
        doc.addEventListener('pointerdown', onPointerDown, true);
        doc.addEventListener('keydown', onKeyDown);
        doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
        win.addEventListener('blur', onScroll);
        win.addEventListener('resize', onScroll);
        onCleanup(() => {
          doc.removeEventListener('pointerdown', onPointerDown, true);
          doc.removeEventListener('keydown', onKeyDown);
          doc.removeEventListener('scroll', onScroll, true);
          win.removeEventListener('blur', onScroll);
          win.removeEventListener('resize', onScroll);
        });
      },
      { flush: 'sync' }
    );

    watch(
      anchor,
      async (current) => {
        placement.value = null;
        if (!current) return;
        await nextTick();
        const panel = panelRef.value;
        if (!panel || !anchor.value) return;
        // The top layer first: a host's stacking context otherwise paints over the panel
        // whatever its own `z-index`. The panel must also be open there to be measured.
        showInTopLayer(panel);
        const { width, height } = panel.getBoundingClientRect();
        const win = hostWindowOf(panel);
        // Right-to-left chrome opens toward the left of the pointer, and flips right instead.
        const rtl = win.getComputedStyle(panel).direction === 'rtl';
        placement.value = placeContextMenu(
          anchor.value,
          { width, height },
          { width: win.innerWidth, height: win.innerHeight },
          rtl
        );
      },
      { flush: 'post' }
    );

    // After the render that makes the panel visible: a `visibility: hidden` panel is not
    // focusable, and the arrow keys are handled on the panel.
    watch(
      placement,
      (current) => {
        if (current) panelRef.value?.focus({ preventScroll: true });
      },
      { flush: 'post' }
    );

    watch(anchor, (current) => {
      const open = current !== null;
      if (open === wasOpen.value) return;
      wasOpen.value = open;
      openChangeRef.value?.(open);
    });

    const menuContext = computed<MenuContextValue>(() => ({
      t: props.t,
      openMenu: null,
      setOpenMenu: () => close(true),
      activeMenu: null,
      onOpen: undefined,
      onSave: undefined,
      onPageSetup: undefined,
      onParagraphDialog: undefined,
      onReportIssue: undefined,
      reportIssue: undefined,
    }));

    const contextMenuContext = computed(() => ({
      close,
      anchor: anchor.value,
      tocId: tocId.value,
      target: target.value,
      clipboardRefusal: clipboardRefusal.value,
      reportClipboardRefusal: (reason: string) => {
        clipboardRefusal.value = reason;
      },
    }));

    provide(MenuContext, menuContext);
    provide(ContextMenuContext, contextMenuContext);

    return () => {
      const style: CSSProperties = {
        position: 'fixed',
        left: `${placement.value?.left ?? anchor.value?.x ?? 0}px`,
        top: `${placement.value?.top ?? anchor.value?.y ?? 0}px`,
        ...(placement.value
          ? {
              maxWidth: `${placement.value.maxWidth}px`,
              maxHeight: `${placement.value.maxHeight}px`,
            }
          : {}),
        visibility: placement.value ? 'visible' : 'hidden',
        pointerEvents: 'auto',
      };

      const children = flattenChildren(slots.default?.() ?? []);
      const startRows = children.filter(startPlacedChild);
      if (props.preset !== false) warnPackagedRowsIn(startRows, rowOfChild);
      const restChildren = children.filter((child) => !startPlacedChild(child));

      const rows =
        props.preset === false
          ? [h(StartPlacementRegion, { placement: 'verbatim' }, () => children)]
          : [
              h(StartPlacementRegion, { placement: 'hoisted' }, () => startRows),
              h(StartPlacementRegion, { placement: 'appended' }, () =>
                mergeArrangement({
                  entries: defaultSet.value,
                  children: restChildren,
                  preset: props.preset,
                  keyOfEntry: (entry) => entry.id,
                  keyOfChild: (child) => contextMenuRowId(rowOfChild(child)),
                  renderEntry: (entry) =>
                    entry.kind === 'separator' ? <MenuSeparator /> : entry.render(),
                  onUnmatched: (id, vnode) => {
                    // An unmatched override is the host's own row, unless it is hidden.
                    const hidden = vnode.props?.hidden;
                    if (hidden === true || hidden === '') warnUnmatchedHiddenRow(id);
                  },
                })
              ),
            ];

      return h(
        'div',
        {
          ref: (element: unknown) => {
            hostRef.value =
              isHTMLElementNode(element) && element.localName === 'div'
                ? (element as HTMLDivElement)
                : null;
          },
          class: 'docx-contextmenu-host',
          style: {
            position: 'absolute',
            width: 0,
            height: 0,
            overflow: 'visible',
            pointerEvents: 'none',
          },
        },
        anchor.value
          ? [
              h(
                'div',
                {
                  ref: (element: unknown) => {
                    panelRef.value =
                      isHTMLElementNode(element) && element.localName === 'div'
                        ? (element as HTMLDivElement)
                        : null;
                  },
                  role: 'menu',
                  'aria-label':
                    props.t?.('contextMenu.ariaLabel') ??
                    catalogT('contextMenu.ariaLabel' as TranslationKey),
                  tabindex: -1,
                  class: `${scopeClassName()}docx-toolbar__menu docx-contextmenu${props.className ? ` ${props.className}` : ''}`,
                  dir: chromeDir.value,
                  style,
                  onKeydown: (event: KeyboardEvent) => {
                    const panel = panelRef.value;
                    if (!panel) return;
                    const items = panelItems(panel);
                    const doc = hostDocumentOf(panel);
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      focusBy(items, doc.activeElement, 1);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      focusBy(items, doc.activeElement, -1);
                    } else if (event.key === 'Home') {
                      event.preventDefault();
                      focusEdge(items, 'first');
                    } else if (event.key === 'End') {
                      event.preventDefault();
                      focusEdge(items, 'last');
                    } else {
                      return;
                    }
                    // A menu taller than the window scrolls; keep the focused row in view.
                    revealMenuItem(panel, doc.activeElement);
                  },
                },
                rows
              ),
            ]
          : []
      );
    };
  },
});

/** @public */
export interface DocxEditorContextMenuNamespace {
  (props: DocxEditorContextMenuProps): VNode;
  readonly Cut: typeof ContextMenuCut;
  readonly Copy: typeof ContextMenuCopy;
  readonly Paste: typeof ContextMenuPaste;
  readonly PasteWithoutFormatting: typeof ContextMenuPasteWithoutFormatting;
  readonly Delete: typeof ContextMenuDelete;
  readonly SelectAll: typeof ContextMenuSelectAll;
  readonly SelectTable: typeof ContextMenuSelectTable;
  readonly InsertRowAbove: typeof ContextMenuInsertRowAbove;
  readonly InsertRowBelow: typeof ContextMenuInsertRowBelow;
  readonly InsertColumnLeft: typeof ContextMenuInsertColumnLeft;
  readonly InsertColumnRight: typeof ContextMenuInsertColumnRight;
  readonly MergeCells: typeof ContextMenuMergeCells;
  readonly SplitCell: typeof ContextMenuSplitCell;
  readonly DeleteTableRow: typeof ContextMenuDeleteTableRow;
  readonly DeleteTableColumn: typeof ContextMenuDeleteTableColumn;
  readonly DeleteTable: typeof ContextMenuDeleteTable;
  readonly CellVerticalAlignment: typeof ContextMenuCellVerticalAlignment;
  readonly RefreshToc: typeof ContextMenuRefreshToc;
  readonly RefreshTocPageNumbers: typeof ContextMenuRefreshTocPageNumbers;
  readonly RemoveToc: typeof ContextMenuRemoveToc;
  readonly Item: typeof ContextMenuItem;
  /** Host rows that render above the packaged rows instead of after them. */
  readonly Start: typeof ContextMenuStart;
  readonly Slot: typeof MenuItem;
  readonly Row: typeof MenuRow;
  readonly Group: typeof MenuGroup;
  readonly Separator: typeof MenuSeparator;
  readonly Submenu: typeof MenuSubmenu;
}

/** @public */
export const ContextMenu = Object.assign(DocxEditorContextMenu, {
  Cut: ContextMenuCut,
  Copy: ContextMenuCopy,
  Paste: ContextMenuPaste,
  PasteWithoutFormatting: ContextMenuPasteWithoutFormatting,
  Delete: ContextMenuDelete,
  SelectAll: ContextMenuSelectAll,
  SelectTable: ContextMenuSelectTable,
  InsertRowAbove: ContextMenuInsertRowAbove,
  InsertRowBelow: ContextMenuInsertRowBelow,
  InsertColumnLeft: ContextMenuInsertColumnLeft,
  InsertColumnRight: ContextMenuInsertColumnRight,
  MergeCells: ContextMenuMergeCells,
  SplitCell: ContextMenuSplitCell,
  DeleteTableRow: ContextMenuDeleteTableRow,
  DeleteTableColumn: ContextMenuDeleteTableColumn,
  DeleteTable: ContextMenuDeleteTable,
  CellVerticalAlignment: ContextMenuCellVerticalAlignment,
  RefreshToc: ContextMenuRefreshToc,
  RefreshTocPageNumbers: ContextMenuRefreshTocPageNumbers,
  RemoveToc: ContextMenuRemoveToc,
  Item: ContextMenuItem,
  Start: ContextMenuStart,
  Slot: MenuItem,
  Row: MenuRow,
  Group: MenuGroup,
  Separator: MenuSeparator,
  Submenu: MenuSubmenu,
}) as unknown as DocxEditorContextMenuNamespace;
