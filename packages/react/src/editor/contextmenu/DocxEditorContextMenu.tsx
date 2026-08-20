import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The compound context menu: the right-click surface, as a panel of menu rows.
//
// DEFAULT-SET + IN-PLACE OVERRIDE, the same contract the toolbar and the menu bar have.
// With no children it renders the packaged set; a child carrying a `docxRow` static
// REPLACES that row where it stands, `hidden` removes it, other children append, and
// `preset={false}` renders children verbatim.
//
// RIGHT-CLICK DOES NOT MOVE THE CARET, and that is the engine's decision rather than this
// component's omission: the surface's pointer controller ignores every non-primary button
// so that "a right-click must reach the context menu with the existing selection intact,
// not move the caret out from under it". The menu therefore always acts on the selection
// the user already had, which is what makes Cut and Copy mean what they appear to mean.
//
// The panel is `position: fixed`. Client coordinates go straight in with no ancestor
// scroll, transform or offset-parent math, and scrolling closes the panel anyway — so the
// one thing fixed positioning cannot do is the one thing that never happens.

import {
  Children,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { mergeArrangement, unwrapFragment } from '../merge-arrangement';
import { ReviewRailContext, useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import type { EditorSnapshot } from '@docx-editor.dev/core';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import {
  MenuContext,
  useMenuContext,
  useMenuLabel,
  type MenuContextValue,
} from '../menu/menu-context';
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
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';

/** Distance kept between the panel and the window edge when it flips. @internal */
const VIEWPORT_INSET = 8;

/** Props for `DocxEditor.ContextMenu`. @public */
export interface DocxEditorContextMenuProps {
  /** Appended after the base `docx-contextmenu` class. */
  className?: string;
  /** i18n resolver for row labels; without it the raw keys show (never English). */
  t?: ToolbarTranslate;
  /**
   * `false` renders children verbatim with no default set. Default `true`: a child naming a
   * packaged row overrides it in place, others append.
   */
  preset?: boolean;
  /**
   * `true` suppresses the panel entirely and lets the browser's own menu through. For a
   * host that wants the native menu back on some documents without unmounting the part.
   */
  disabled?: boolean;
  /** Notified whenever the panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
  children?: DocxEditorChildren;
}

/** Viewing refuses every review write, comment authoring included. */
const selectDocumentReadOnly = (snapshot: EditorSnapshot): boolean =>
  snapshot.editingMode === 'viewing';

/** The packaged set, in order. Separators are positional, so they are part of the list. */
type DefaultEntry =
  | { readonly kind: 'row'; readonly id: string; readonly render: () => ReactElement }
  | { readonly kind: 'separator'; readonly id: string };

function ContextMenuAddComment() {
  const editor = useDocxEditor();
  const rail = useContext(ReviewRailContext);
  const menu = useMenuContext();
  const label = useMenuLabel();
  const gate = editor?.can({ type: 'toggleReviewPane' });
  // `toggleReviewPane` is deliberately NON-mutating, so it stays `ok` in viewing — and this
  // row, which writes a comment, rode on it and showed up fully enabled. It then closed the
  // menu and wrote nothing, because the rail refuses a draft on a read-only document.
  const readOnly = useEditorState(selectDocumentReadOnly);
  const disabled =
    !gate?.ok || readOnly || (rail?.mounted ?? 0) === 0 || editor?.getSelectionPlacement() === null;
  const control = chromeControlForSlot('review.comments');
  return (
    <MenuRow
      icon={chromeIcon(control?.paths)}
      slot="review.comments"
      disabled={disabled}
      title={gate && !gate.ok ? gate.reason : undefined}
      onSelect={() => {
        if (!rail?.requestCommentDraft()) return;
        menu.setOpenMenu(null);
      }}
    >
      {label('comments.addComment')}
    </MenuRow>
  );
}

const BASE_DEFAULT_SET: readonly DefaultEntry[] = [
  { kind: 'row', id: 'edit.cut', render: () => <ContextMenuCut /> },
  { kind: 'row', id: 'edit.copy', render: () => <ContextMenuCopy /> },
  { kind: 'row', id: 'edit.paste', render: () => <ContextMenuPaste /> },
  { kind: 'separator', id: 'sep.clipboard' },
  { kind: 'row', id: 'edit.delete', render: () => <ContextMenuDelete /> },
  { kind: 'row', id: 'edit.selectAll', render: () => <ContextMenuSelectAll /> },
  { kind: 'separator', id: 'sep.selection' },
  // PLAIN-LABEL keys, stated rather than inherited. A slot's registry `labelKey` is
  // tooltip-shaped — `text.link` carries "Insert link (Ctrl+K)" — which is right above a
  // toolbar button and wrong on a menu row that already has its own shortcut column. The
  // menu bar states them for the same reason; these two slots are in no registry menu, so
  // there is no entry to inherit from.
  {
    kind: 'row',
    id: 'text.link',
    render: () => (
      // No shortcut column: the catalogue has no plain "Ctrl+K" key, and inventing one
      // here would put a literal English keystroke in a row every locale renders.
      <MenuItem slot="text.link" labelKey="formattingBar.insertLink" />
    ),
  },
  {
    kind: 'row',
    id: 'review.comments',
    render: () => <ContextMenuAddComment />,
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

/** Build the default set, with the contextual groups the current target earns. @internal */
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

/**
 * The row id a child drives, or null when it is the host's own content.
 *
 * Reads EVERY marker a packaged row can carry — `docxRow` on this module's parts,
 * `docxMenuRow` plus the `slot` prop on the menu bar's generic `MenuItem`, and `docxSlot`
 * on its pinned parts — and unwraps a single-child Fragment, because `Children.toArray`
 * does not flatten Fragment elements and a host mapping over its overrides will wrap them.
 * Missing any of those shapes is not a no-op: an unrecognized child APPENDS, so the row it
 * meant to replace renders twice.
 */
function rowOfChild(child: ReactNode): string | null {
  if (!isValidElement(child)) return null;
  const unwrapped = unwrapFragment(child, rowOfChild);
  if (unwrapped !== null) return unwrapped;
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

/**
 * Whether a child asked to render ABOVE the default set.
 *
 * A component carrying `docxRowPlacement: 'start'` (a static, like `docxRow`) renders
 * before the packaged rows instead of appending after them — the shape a contextual
 * section wants: "you right-clicked one of MINE" belongs at the top, where the pointer is.
 */
function startPlacedChild(child: ReactNode): boolean {
  if (!isValidElement(child)) return false;
  const type = child.type as { docxRowPlacement?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return false;
  return type.docxRowPlacement === 'start';
}

/**
 * The element this menu listens on: the SCROLL CONTAINER, not the painted surface.
 *
 * The class is the one the engine itself keys on, so a page with two editors gives each
 * menu its own scroller. Listening here rather than on `.docx-paginated-surface` is
 * deliberate: the surface is centred inside the scroller with a margin, and a right-click in
 * the grey gutter beside the page originates on the scroller and never reaches a listener
 * further in. Word opens its menu there too.
 */
function scrollerFor(anchor: HTMLElement | null): HTMLElement | null {
  return anchor?.closest<HTMLElement>('.docx-editor__scroll-container') ?? null;
}

/**
 * The packaged right-click menu over the painted document.
 *
 * Mounted by default inside `DocxEditor.Viewport`; `contextMenu={false}` on `DocxEditor`
 * removes it. Rendered as a child of the viewport so it finds its own surface, but
 * positioned in client space, so it is never clipped by the scroller.
 *
 * @public
 */
export function DocxEditorContextMenu({
  className,
  t,
  preset = true,
  disabled,
  onOpenChange,
  children,
}: DocxEditorContextMenuProps) {
  // Skip the scope class when the packaged wrapper already carries it.
  const scopeClassName = useScopeClassName();
  const editor = useDocxEditor();
  const { t: catalogT } = useTranslation();
  const tableContextVisible = useTableContextMenuVisible();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  // Captured with the anchor, not subscribed to — see `tocId` on the context value.
  const [tocId, setTocId] = useState<string | null>(null);
  // The element the opening press landed on, for contextual rows. Same capture rule.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const defaultSet = useMemo(
    () => contextMenuDefaultSet(tableContextVisible, tocId !== null),
    [tableContextVisible, tocId]
  );
  // Placement is measured AFTER the panel renders — its size depends on the rows the host
  // composed — so the first paint is at the raw anchor and the flip lands in a layout
  // effect, before the browser paints.
  const [placement, setPlacement] = useState<ContextMenuAnchor | null>(null);

  /**
   * Close the panel.
   *
   * `restoreFocus` only on the paths where the user is FINISHING with the menu — Escape, or
   * selecting a row. On the others (a press elsewhere, a scroll, the window losing focus)
   * the user is already going somewhere else, and calling `editor.focus()` would drag focus
   * back into the document and can scroll the caret into view under them.
   */
  const close = useCallback(
    (restoreFocus = false) => {
      setAnchor(null);
      setPlacement(null);
      setTocId(null);
      setTarget(null);
      if (restoreFocus) editor?.focus();
    },
    [editor]
  );

  // Open on the scroller's contextmenu event.
  useEffect(() => {
    if (disabled) return undefined;
    const scroller = scrollerFor(hostRef.current);
    if (!scroller) return undefined;
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // A keyboard-triggered menu (Shift+F10, the Menu key) reports no pointer position.
      // Anchoring at the window's origin would drop the panel in the corner, so it opens at
      // the scroller's top-left instead — the best position available without a caret rect,
      // and clamped like any other anchor below (a scrolled document puts that rect's `top`
      // far off the top of the window).
      const keyboard = event.button === -1 || (event.clientX === 0 && event.clientY === 0);
      const box = scroller.getBoundingClientRect();
      // The engine's own listener sits INSIDE this one and has already recorded which table
      // of contents the press landed on, so reading it here is reading it current.
      setTocId(editor?.snapshot().tocContext?.id ?? null);
      setTarget(keyboard || !(event.target instanceof HTMLElement) ? null : event.target);
      setAnchor(
        keyboard ? { x: box.left + 16, y: box.top + 16 } : { x: event.clientX, y: event.clientY }
      );
    };
    scroller.addEventListener('contextmenu', onContextMenu);
    return () => scroller.removeEventListener('contextmenu', onContextMenu);
  }, [disabled, editor]);

  // `disabled` flipping true closes an OPEN panel, not just the listener. The prop promises
  // the browser's own menu back; leaving ours on screen would be the opposite.
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  // Close on everything that means "the user moved on": a press outside, Escape, a scroll
  // under the panel, and the window losing focus. Bound only while open, so a closed menu
  // costs nothing.
  useEffect(() => {
    if (!anchor) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node | null)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        // Tab moves focus OUT of the menu, and neither the outside-press listener nor the
        // window blur handler fires for an intra-page focus move — so without this the panel
        // stays open, floating over the document, with nothing focused inside it. The menu
        // bar closes on Tab for the same reason. Not prevented: the user asked to move on.
        close();
      }
    };
    // Capture, because the scroll that matters is the editor's own scroller and scroll
    // events do not bubble to the window from it.
    const onScroll = () => close();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('blur', onScroll);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, close]);

  // Flip to stay on screen.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const { width, height } = panel.getBoundingClientRect();
    const maxX = window.innerWidth - width - VIEWPORT_INSET;
    const maxY = window.innerHeight - height - VIEWPORT_INSET;
    // Flip to the other side of the pointer when there is no room past it, then clamp BOTH
    // ends. The low end is not theoretical: a keyboard-invoked menu anchors on the scroller's
    // client rect, whose `top` is far negative once the reader is on page ten, and an
    // unclamped `position: fixed` panel then renders thousands of pixels above the window.
    const x = Math.max(VIEWPORT_INSET, anchor.x > maxX ? anchor.x - width : anchor.x);
    const y = Math.max(VIEWPORT_INSET, anchor.y > maxY ? anchor.y - height : anchor.y);
    setPlacement({ x, y });
  }, [anchor]);

  // Focus AFTER placement commits, not in the same effect that computes it.
  //
  // The panel renders `visibility: hidden` until it has been measured, so that it is never
  // seen at the pre-flip position — and a `visibility: hidden` element is not focusable.
  // Calling `focus()` alongside `setPlacement` therefore did nothing at all, which left the
  // whole keyboard layer dead: the arrow-key handler is on the panel, so it never fired.
  useLayoutEffect(() => {
    if (placement) panelRef.current?.focus({ preventScroll: true });
  }, [placement]);

  // Report only real TRANSITIONS.
  //
  // The handler lives in a ref so an unmemoized one — the normal case, and unavoidable via
  // `contextMenu={{ onOpenChange }}`, which is a fresh object every render — cannot make
  // this effect re-run and re-report. Without the previous-value guard it also announced
  // `false` on mount, before the menu had ever existed.
  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;
  const wasOpen = useRef(false);
  useEffect(() => {
    const open = anchor !== null;
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    openChangeRef.current?.(open);
  }, [anchor]);

  // The menu bar's rows close their panel through `setOpenMenu(null)`. Publishing a menu
  // context whose `setOpenMenu` closes THIS panel is the whole adapter between the two
  // compounds, and it is what lets the rows be reused rather than reimplemented.
  const menuContext = useMemo<MenuContextValue>(
    () => ({
      t,
      openMenu: null,
      // A row was selected: the user is finished with the menu, so focus goes back.
      setOpenMenu: () => close(true),
      activeMenu: null,
      onOpen: undefined,
      onSave: undefined,
      onPageSetup: undefined,
      onReportIssue: undefined,
      reportIssue: undefined,
    }),
    [t, close]
  );
  // Root-owned, so it survives the panel unmounting when a row is selected.
  const [clipboardRefusal, setClipboardRefusal] = useState<string | null>(null);
  const contextMenuContext = useMemo(
    () => ({
      close,
      anchor,
      tocId,
      target,
      clipboardRefusal,
      reportClipboardRefusal: setClipboardRefusal,
    }),
    [close, anchor, tocId, target, clipboardRefusal]
  );

  const style: CSSProperties = {
    position: 'fixed',
    left: (placement ?? anchor)?.x ?? 0,
    top: (placement ?? anchor)?.y ?? 0,
    // Hidden until measured, so the panel is never seen at the pre-flip position.
    visibility: placement ? 'visible' : 'hidden',
  };

  return (
    <div ref={hostRef} style={{ display: 'contents' }}>
      {anchor ? (
        <MenuContext.Provider value={menuContext}>
          <ContextMenuContext.Provider value={contextMenuContext}>
            <div
              ref={panelRef}
              role="menu"
              // Resolved through the host's `t` like every row label, else the locale
              // catalogue — matching the rows' own fallback.
              aria-label={
                t?.('contextMenu.ariaLabel') ?? catalogT('contextMenu.ariaLabel' as TranslationKey)
              }
              // One tab stop for the whole panel, which is the menu pattern: rows are
              // reached with the arrows, never with Tab.
              tabIndex={-1}
              className={`${scopeClassName}docx-toolbar__menu docx-contextmenu${className ? ` ${className}` : ''}`}
              style={style}
              onKeyDown={(event) => {
                const panel = panelRef.current;
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
              {Children.toArray(children).filter(startPlacedChild)}
              {mergeArrangement({
                entries: defaultSet,
                children: Children.toArray(children).filter((child) => !startPlacedChild(child)),
                preset,
                keyOfEntry: (entry) => entry.id,
                keyOfChild: rowOfChild,
                renderEntry: (entry) =>
                  entry.kind === 'separator' ? <MenuSeparator /> : entry.render(),
              })}
            </div>
          </ContextMenuContext.Provider>
        </MenuContext.Provider>
      ) : null}
    </div>
  );
}

/**
 * `DocxEditor.ContextMenu` with its rows attached as statics.
 *
 * @public
 */
export interface DocxEditorContextMenuNamespace {
  (props: DocxEditorContextMenuProps): ReactElement;
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
  /** A host-owned row: no slot, no command, the host's own label and action. */
  readonly Item: typeof ContextMenuItem;
  /** Any chrome slot as a live row (`<ContextMenu.Slot slot="text.bold" />`). */
  readonly Slot: typeof MenuItem;
  /** Bare row presentation, for a host building something the parts do not cover. */
  readonly Row: typeof MenuRow;
  /** A named section of rows: a visible heading plus a real ARIA group. */
  readonly Group: typeof MenuGroup;
  readonly Separator: typeof MenuSeparator;
  readonly Submenu: typeof MenuSubmenu;
}

export const ContextMenu: DocxEditorContextMenuNamespace = Object.assign(DocxEditorContextMenu, {
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
});
