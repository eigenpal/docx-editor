import {
  computed,
  defineComponent,
  Fragment,
  inject,
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
import { mergeArrangement } from '../merge-arrangement';
import { flattenChildren } from '../../lib/flattenChildren';
import { useDocxEditor, editorStateTickKey } from '../context';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import { MenuContext, type MenuContextValue } from '../menu/menu-context';
import { focusBy, focusEdge, panelItems } from '../menu/menu-keyboard';
import { MenuGroup, MenuItem, MenuRow, MenuSeparator, MenuSubmenu } from '../menu/parts';
import { ContextMenuContext, type ContextMenuAnchor } from './contextmenu-context';
import {
  ContextMenuCopy,
  ContextMenuCellVerticalAlignment,
  ContextMenuCut,
  ContextMenuDelete,
  ContextMenuDeleteTable,
  ContextMenuDeleteTableColumn,
  ContextMenuDeleteTableRow,
  ContextMenuInsertColumnLeft,
  ContextMenuInsertColumnRight,
  ContextMenuInsertRowAbove,
  ContextMenuInsertRowBelow,
  ContextMenuItem,
  ContextMenuPaste,
  ContextMenuSelectAll,
  ContextMenuRefreshToc,
  ContextMenuRefreshTocPageNumbers,
  useTableContextMenuVisible,
} from './parts';
import { useScopeClassName } from '../scope-context';

const VIEWPORT_INSET = 8;

/** @public */
export interface DocxEditorContextMenuProps {
  className?: string;
  t?: ToolbarTranslate;
  preset?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: VNode;
}

type DefaultEntry =
  | { readonly kind: 'row'; readonly id: string; readonly render: () => VNode }
  | { readonly kind: 'separator'; readonly id: string };

const BASE_DEFAULT_SET: readonly DefaultEntry[] = [
  { kind: 'row', id: 'edit.cut', render: () => <ContextMenuCut /> },
  { kind: 'row', id: 'edit.copy', render: () => <ContextMenuCopy /> },
  { kind: 'row', id: 'edit.paste', render: () => <ContextMenuPaste /> },
  { kind: 'separator', id: 'sep.clipboard' },
  { kind: 'row', id: 'edit.delete', render: () => <ContextMenuDelete /> },
  { kind: 'row', id: 'edit.selectAll', render: () => <ContextMenuSelectAll /> },
  { kind: 'separator', id: 'sep.selection' },
  {
    kind: 'row',
    id: 'text.link',
    render: () => (
      <MenuItem
        {...({ slot: 'text.link' } as { slot: 'text.link' })}
        labelKey="formattingBar.insertLink"
      />
    ),
  },
  {
    kind: 'row',
    id: 'review.comments',
    render: () => (
      <MenuItem
        {...({ slot: 'review.comments' } as { slot: 'review.comments' })}
        labelKey="comments.addComment"
      />
    ),
  },
];

function tableContextEntries(): readonly DefaultEntry[] {
  return [
    { kind: 'separator', id: 'sep.table' },
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
    const slot = (child.props as { slot?: unknown }).slot;
    if (typeof slot === 'string') return slot;
  }
  return null;
}

function startPlacedChild(child: unknown): boolean {
  if (!isVNodeElement(child)) return false;
  const type = child.type as { docxRowPlacement?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return false;
  return type.docxRowPlacement === 'start';
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
    const scopeClassName = useScopeClassName();
    const editorRef = useDocxEditor();
    const tick = inject(editorStateTickKey, shallowRef(0));
    const { t: catalogT } = useTranslation();
    const tableContextVisible = useTableContextMenuVisible();
    const hostRef = ref<HTMLDivElement | null>(null);
    const panelRef = ref<HTMLDivElement | null>(null);
    const anchor = ref<ContextMenuAnchor | null>(null);
    const tocId = ref<string | null>(null);
    const target = ref<HTMLElement | null>(null);
    const placement = ref<ContextMenuAnchor | null>(null);
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

    watchEffect(
      (onCleanup) => {
        if (props.disabled) return;
        void tick.value;
        if (!editorRef.value?.surface) return;
        const scroller =
          scrollerFor(hostRef.value) ??
          document.querySelector<HTMLElement>('.docx-editor__scroll-container');
        if (!scroller) return;
        const onContextMenu = (event: MouseEvent) => {
          event.preventDefault();
          const keyboard = event.button === -1 || (event.clientX === 0 && event.clientY === 0);
          const box = scroller.getBoundingClientRect();
          tocId.value = editorRef.value?.snapshot().tocContext?.id ?? null;
          target.value = keyboard || !(event.target instanceof HTMLElement) ? null : event.target;
          anchor.value = keyboard
            ? { x: box.left + 16, y: box.top + 16 }
            : { x: event.clientX, y: event.clientY };
        };
        scroller.addEventListener('contextmenu', onContextMenu);
        onCleanup(() => scroller.removeEventListener('contextmenu', onContextMenu));
      },
      { flush: 'post' }
    );

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
        const onScroll = () => close();
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        window.addEventListener('blur', onScroll);
        window.addEventListener('resize', onScroll);
        onCleanup(() => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('blur', onScroll);
          window.removeEventListener('resize', onScroll);
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
        const { width, height } = panel.getBoundingClientRect();
        const maxX = window.innerWidth - width - VIEWPORT_INSET;
        const maxY = window.innerHeight - height - VIEWPORT_INSET;
        const x = Math.max(
          VIEWPORT_INSET,
          anchor.value.x > maxX ? anchor.value.x - width : anchor.value.x
        );
        const y = Math.max(
          VIEWPORT_INSET,
          anchor.value.y > maxY ? anchor.value.y - height : anchor.value.y
        );
        placement.value = { x, y };
      },
      { flush: 'post' }
    );

    watch(placement, (current) => {
      if (current) panelRef.value?.focus({ preventScroll: true });
    });

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
        left: (placement.value ?? anchor.value)?.x ?? 0,
        top: (placement.value ?? anchor.value)?.y ?? 0,
        visibility: placement.value ? 'visible' : 'hidden',
      };

      const children = flattenChildren(slots.default?.() ?? []);
      const startRows = children.filter(startPlacedChild);
      const restChildren = children.filter((child) => !startPlacedChild(child));

      const rows =
        props.preset === false
          ? children
          : [
              ...startRows,
              ...mergeArrangement({
                entries: defaultSet.value,
                children: restChildren,
                preset: props.preset,
                keyOfEntry: (entry) => entry.id,
                keyOfChild: rowOfChild,
                renderEntry: (entry) =>
                  entry.kind === 'separator' ? <MenuSeparator /> : entry.render(),
              }),
            ];

      return (
        <div ref={hostRef} style={{ display: 'contents' }}>
          {anchor.value ? (
            <div
              ref={panelRef}
              role="menu"
              aria-label={
                props.t?.('contextMenu.ariaLabel') ??
                catalogT.value('contextMenu.ariaLabel' as TranslationKey)
              }
              tabindex={-1}
              class={`${scopeClassName}docx-toolbar__menu docx-contextmenu${props.className ? ` ${props.className}` : ''}`}
              style={style}
              onKeydown={(event: KeyboardEvent) => {
                const panel = panelRef.value;
                if (!panel) return;
                const items = panelItems(panel);
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  focusBy(items, document.activeElement, 1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  focusBy(items, document.activeElement, -1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  focusEdge(items, 'first');
                } else if (event.key === 'End') {
                  event.preventDefault();
                  focusEdge(items, 'last');
                }
              }}
            >
              {rows}
            </div>
          ) : null}
        </div>
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
  readonly Delete: typeof ContextMenuDelete;
  readonly SelectAll: typeof ContextMenuSelectAll;
  readonly InsertRowAbove: typeof ContextMenuInsertRowAbove;
  readonly InsertRowBelow: typeof ContextMenuInsertRowBelow;
  readonly InsertColumnLeft: typeof ContextMenuInsertColumnLeft;
  readonly InsertColumnRight: typeof ContextMenuInsertColumnRight;
  readonly DeleteTableRow: typeof ContextMenuDeleteTableRow;
  readonly DeleteTableColumn: typeof ContextMenuDeleteTableColumn;
  readonly DeleteTable: typeof ContextMenuDeleteTable;
  readonly CellVerticalAlignment: typeof ContextMenuCellVerticalAlignment;
  readonly RefreshToc: typeof ContextMenuRefreshToc;
  readonly RefreshTocPageNumbers: typeof ContextMenuRefreshTocPageNumbers;
  readonly Item: typeof ContextMenuItem;
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
  Delete: ContextMenuDelete,
  SelectAll: ContextMenuSelectAll,
  InsertRowAbove: ContextMenuInsertRowAbove,
  InsertRowBelow: ContextMenuInsertRowBelow,
  InsertColumnLeft: ContextMenuInsertColumnLeft,
  InsertColumnRight: ContextMenuInsertColumnRight,
  DeleteTableRow: ContextMenuDeleteTableRow,
  DeleteTableColumn: ContextMenuDeleteTableColumn,
  DeleteTable: ContextMenuDeleteTable,
  CellVerticalAlignment: ContextMenuCellVerticalAlignment,
  RefreshToc: ContextMenuRefreshToc,
  RefreshTocPageNumbers: ContextMenuRefreshTocPageNumbers,
  Item: ContextMenuItem,
  Slot: MenuItem,
  Row: MenuRow,
  Group: MenuGroup,
  Separator: MenuSeparator,
  Submenu: MenuSubmenu,
}) as unknown as DocxEditorContextMenuNamespace;
