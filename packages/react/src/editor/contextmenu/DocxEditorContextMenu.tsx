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
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useDocxEditor } from '../context';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import { MenuContext, type MenuContextValue } from '../menu/menu-context';
import { focusBy, focusEdge, panelItems } from '../menu/menu-keyboard';
import { MenuItem, MenuRow, MenuSeparator, MenuSubmenu } from '../menu/parts';
import { ContextMenuContext, type ContextMenuAnchor } from './contextmenu-context';
import {
  ContextMenuCopy,
  ContextMenuCut,
  ContextMenuDelete,
  ContextMenuItem,
  ContextMenuPaste,
  ContextMenuSelectAll,
} from './parts';

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
  children?: ReactNode;
}

/** The packaged set, in order. Separators are positional, so they are part of the list. */
type DefaultEntry =
  | { readonly kind: 'row'; readonly id: string; readonly render: () => ReactElement }
  | { readonly kind: 'separator'; readonly id: string };

const DEFAULT_SET: readonly DefaultEntry[] = [
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
    render: () => <MenuItem slot="review.comments" labelKey="comments.addComment" />,
  },
];

/**
 * The row id a child drives, or null when it is the host's own content.
 *
 * Reads the `docxRow` static on the packaged parts and the `slot` PROP on the generic
 * slot row — the same two shapes the menu bar recognizes, and for the same reason: an
 * unrecognized child is APPENDED, so missing one renders that row twice.
 */
function rowOfChild(child: ReactNode): string | null {
  if (!isValidElement(child)) return null;
  const type = child.type as { docxRow?: string } | undefined;
  if (typeof type?.docxRow === 'string') return type.docxRow;
  if (type === MenuItem) {
    const slot = (child.props as { slot?: string }).slot;
    return typeof slot === 'string' ? slot : null;
  }
  return null;
}

/** Merge host children into the packaged set: override in place, append the rest. */
function mergeRows(children: ReactNode, preset: boolean): ReactNode {
  if (!preset) return children;
  const overrides = new Map<string, ReactElement>();
  const appended: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    const id = rowOfChild(child);
    // Last override for a row wins, matching how later props win in a spread.
    if (id) overrides.set(id, child as ReactElement);
    else appended.push(child);
  }
  const base = DEFAULT_SET.map((entry) => {
    const override = overrides.get(entry.id);
    // A `hidden` override renders null where it stands, removing the row.
    if (override) return <Fragment key={entry.id}>{override}</Fragment>;
    return entry.kind === 'separator' ? (
      <MenuSeparator key={entry.id} />
    ) : (
      <Fragment key={entry.id}>{entry.render()}</Fragment>
    );
  });
  const known = new Set(DEFAULT_SET.map((entry) => entry.id));
  const unmatched = [...overrides.entries()]
    .filter(([id]) => !known.has(id))
    .map(([id, element]) => <Fragment key={id}>{element}</Fragment>);
  return (
    <>
      {base}
      {unmatched}
      {appended}
    </>
  );
}

/**
 * The painted surface this menu belongs to, found from the part's own position in the tree.
 *
 * Walks up to the scroll container — the class the engine itself keys on — and takes the
 * paint target inside it, so a page with two editors gives each menu its own surface. Falls
 * back to the scroll container, which is where clicks in the margin around the page land.
 */
function surfaceFor(anchor: HTMLElement | null): HTMLElement | null {
  const scroller = anchor?.closest<HTMLElement>('.docx-editor__scroll-container');
  if (!scroller) return null;
  return scroller.querySelector<HTMLElement>('.docx-paginated-surface') ?? scroller;
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
  const editor = useDocxEditor();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  // Placement is measured AFTER the panel renders — its size depends on the rows the host
  // composed — so the first paint is at the raw anchor and the flip lands in a layout
  // effect, before the browser paints.
  const [placement, setPlacement] = useState<ContextMenuAnchor | null>(null);

  const close = useCallback(() => {
    setAnchor(null);
    setPlacement(null);
    // Focus goes back to the document: every close path unmounts the panel, so without this
    // the element holding focus disappears and focus falls to <body>.
    editor?.focus();
  }, [editor]);

  // Open on the surface's own contextmenu event.
  useEffect(() => {
    if (disabled) return undefined;
    const surface = surfaceFor(hostRef.current);
    if (!surface) return undefined;
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // A keyboard-triggered menu (Shift+F10, the Menu key) reports no pointer position.
      // Anchoring at the window's origin would drop the panel in the corner, so it opens at
      // the surface instead — the best position available without a caret rect.
      const keyboard = event.button === -1 || (event.clientX === 0 && event.clientY === 0);
      const box = surface.getBoundingClientRect();
      setAnchor(
        keyboard ? { x: box.left + 16, y: box.top + 16 } : { x: event.clientX, y: event.clientY }
      );
    };
    surface.addEventListener('contextmenu', onContextMenu);
    return () => surface.removeEventListener('contextmenu', onContextMenu);
  }, [disabled, editor]);

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

  // Flip to stay on screen, then take focus so the arrow keys have somewhere to start.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const { width, height } = panel.getBoundingClientRect();
    const maxX = window.innerWidth - width - VIEWPORT_INSET;
    const maxY = window.innerHeight - height - VIEWPORT_INSET;
    // Flip to the other side of the pointer when there is room there, otherwise clamp: a
    // panel taller than the window must sit at the top edge rather than above it.
    const x = anchor.x > maxX ? Math.max(VIEWPORT_INSET, anchor.x - width) : anchor.x;
    const y = anchor.y > maxY ? Math.max(VIEWPORT_INSET, anchor.y - height) : anchor.y;
    setPlacement({ x, y });
    panel.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    onOpenChange?.(anchor !== null);
  }, [anchor, onOpenChange]);

  // The menu bar's rows close their panel through `setOpenMenu(null)`. Publishing a menu
  // context whose `setOpenMenu` closes THIS panel is the whole adapter between the two
  // compounds, and it is what lets the rows be reused rather than reimplemented.
  const menuContext = useMemo<MenuContextValue>(
    () => ({
      t,
      openMenu: null,
      setOpenMenu: () => close(),
      activeMenu: null,
      onOpen: undefined,
      onSave: undefined,
      onPageSetup: undefined,
      onReportIssue: undefined,
      reportIssue: undefined,
    }),
    [t, close]
  );
  const contextMenuContext = useMemo(() => ({ close, anchor }), [close, anchor]);

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
              aria-label="context menu"
              // One tab stop for the whole panel, which is the menu pattern: rows are
              // reached with the arrows, never with Tab.
              tabIndex={-1}
              className={`docx-toolbar__menu docx-contextmenu${className ? ` ${className}` : ''}`}
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
              {mergeRows(children, preset)}
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
  /** A host-owned row: no slot, no command, the host's own label and action. */
  readonly Item: typeof ContextMenuItem;
  /** Any chrome slot as a live row (`<ContextMenu.Slot slot="text.bold" />`). */
  readonly Slot: typeof MenuItem;
  /** Bare row presentation, for a host building something the parts do not cover. */
  readonly Row: typeof MenuRow;
  readonly Separator: typeof MenuSeparator;
  readonly Submenu: typeof MenuSubmenu;
}

export const ContextMenu: DocxEditorContextMenuNamespace = Object.assign(DocxEditorContextMenu, {
  Cut: ContextMenuCut,
  Copy: ContextMenuCopy,
  Paste: ContextMenuPaste,
  Delete: ContextMenuDelete,
  SelectAll: ContextMenuSelectAll,
  Item: ContextMenuItem,
  Slot: MenuItem,
  Row: MenuRow,
  Separator: MenuSeparator,
  Submenu: MenuSubmenu,
});
