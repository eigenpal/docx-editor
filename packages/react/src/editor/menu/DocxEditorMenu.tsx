// The compound menu bar: File · Format · Insert · Help, derived FROM the chrome registry.
//
// DEFAULT-SET + IN-PLACE OVERRIDE, the same contract the toolbar has. With no children
// the bar renders every menu of `CHROME_MENUS` in registry order; a child that is a menu
// part — recognized by its `docxMenu` static, never by displayName — REPLACES its menu in
// place, `hidden` removes it, other children append, and `preset={false}` opts out.
//
// The bar owns three things the rows cannot own individually:
//
// - WHICH menu is open. One panel at a time, so a click on File closes Insert; the state
//   lives here and rows close the bar by setting it to null.
// - THE HOST-BOUNDARY ACTIONS. Open, save and page setup are not engine commands (bytes
//   and dialog values come from outside), so the root resolves each ONCE — the host's
//   handler when given, else the packaged default — and publishes it. A row that finds no
//   handler renders disabled rather than pretending.
// - THE SHORTCUTS IT ADVERTISES. The File rows print Ctrl+O and Ctrl+S, and the engine
//   keymap binds neither, so the bar binds them itself. A shortcut column that names a key
//   combination nothing listens to is the same class of lie as an enabled dead button.

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CHROME_MENUS, type ChromeMenuId } from '@docx-editor.dev/core-contract/editor';
import { useDocxEditor } from '../context';
import { DocxEditorPageSetupDialog } from '../DocxEditorPageSetup';
import type { ToolbarTranslate } from '../toolbar/toolbar-context';
import { guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { MenuContext, type MenuContextValue, type MenuId } from './menu-context';
import { barTriggers } from './menu-keyboard';
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
  MenuSeparator,
  MenuReportIssue,
  MenuSubmenu,
  MenuTableGrid,
  type MenuPartComponent,
} from './parts';

/** The pinned part for each registry menu, so the default bar is derived, not hand-listed. */
const MENU_PARTS: Record<ChromeMenuId, MenuPartComponent> = {
  file: MenuFile,
  format: MenuFormat,
  insert: MenuInsert,
  help: MenuHelp,
};

/**
 * A download name from a user-typed title.
 *
 * The title is arbitrary text a user typed, and it lands in a `download` attribute — so
 * path separators and control characters come out before it does, and the result is
 * length-capped. Not an injection sink (the browser treats `download` as a plain name),
 * but a name carrying `../` or a newline is a bad file either way.
 */
function downloadName(title: string | undefined): string {
  const base = (title ?? '')
    .replace(/\.docx$/i, '')
    // Path separators, the Windows-reserved set, and control characters — including the
    // newline that would otherwise split the name. Spaces and ordinary punctuation stay:
    // a title is prose, and "Q3 report - draft" should survive as itself.
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${base || 'document'}.docx`;
}

/** Hand DOCX bytes to the browser as a download. */
function download(buffer: ArrayBuffer, name: string): void {
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoked on the next task, not inline: some browsers have not finished reading the
  // blob when `click()` returns, and a revoked URL cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Props for `DocxEditor.Menu`. @public */
export interface DocxEditorMenuProps {
  /** Appended after the base `docx-menubar` class. */
  className?: string;
  /** i18n resolver for row labels; without it the raw keys show (never English). */
  t?: ToolbarTranslate;
  /**
   * Name for the file the packaged Save writes, without the extension. Ignored when
   * `onSave` is given.
   */
  fileName?: string;
  /**
   * Replaces File › Open. The default opens a file picker and hands the bytes to
   * `Editor.load` — a user-driven file READ, never a fetch.
   */
  onOpen?: () => void;
  /** Replaces File › Save. The default runs `Editor.save()` and downloads the bytes. */
  onSave?: () => void;
  /** Replaces File › Page setup. The default opens the packaged Page Setup dialog. */
  onPageSetup?: () => void;
  /**
   * Replaces Help › Report issue. The default opens THIS project's issue tracker,
   * prefilled with the current page URL and user agent — so a host embedding the editor
   * in its own product should point this at its own support channel, or drop the row with
   * `reportIssue={false}`.
   */
  onReportIssue?: () => void;
  /** `false` removes Help › Report issue, and the Help menu with it. Default `true`. */
  reportIssue?: boolean;
  /**
   * `false` renders children verbatim with no default arrangement. Default `true`: menu
   * children override their menu in place, others append.
   */
  preset?: boolean;
  children?: ReactNode;
}

const MENU_IDS = new Set<string>(CHROME_MENUS.map((menu) => menu.id));

/**
 * The menu id one child element drives, or null for a non-menu child.
 *
 * Recognizes THREE shapes, because missing any of them is not a no-op — an unrecognized
 * child is APPENDED, so the bar renders that menu twice and both copies open together
 * (`Menu` keys purely off `openMenu === id`):
 *
 * - a pinned part (`DocxEditor.Menu.File`), by its `docxMenu` static;
 * - the generic `DocxEditor.Menu.Menu` with an `id` prop, which the namespace documents as
 *   "a menu of the bar, addressed by registry id" and which carries no static at all;
 * - either of those wrapped in a Fragment. `Children.toArray` does not flatten Fragment
 *   ELEMENTS, so `child.type` is a symbol and the naive check falls through — which a host
 *   hits the moment it maps over its overrides with a `<>…</>` around them.
 */
function menuOfChild(child: ReactNode): ChromeMenuId | null {
  if (!isValidElement(child)) return null;
  if (child.type === Fragment) {
    // One menu per fragment: a fragment holding two overrides is ambiguous about which
    // slot it replaces, so it appends rather than guessing.
    const inner = Children.toArray((child.props as { children?: ReactNode }).children);
    const ids = inner.map(menuOfChild).filter((id): id is ChromeMenuId => id !== null);
    return ids.length === 1 ? ids[0]! : null;
  }
  const type = child.type as { docxMenu?: unknown };
  if (typeof type === 'function' || typeof type === 'object') {
    if (typeof type.docxMenu === 'string') return type.docxMenu as ChromeMenuId;
  }
  // The generic `Menu`: identity comparison against the exported component, then its own
  // `id` prop. Compared by reference rather than by name — displayName minifies away.
  if (child.type === Menu) {
    const id = (child.props as { id?: unknown }).id;
    if (typeof id === 'string' && MENU_IDS.has(id)) return id as ChromeMenuId;
  }
  return null;
}

function DocxEditorMenuRoot(props: DocxEditorMenuProps) {
  const {
    className,
    t,
    fileName,
    onOpen,
    onSave,
    onPageSetup,
    onReportIssue,
    reportIssue,
    preset = true,
    children,
  } = props;
  const editor = useDocxEditor();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  // The bar's single tab stop. Defaults to the first rendered menu; arrowing along the bar
  // moves it, and opening a menu takes it so Escape returns focus somewhere sensible.
  const [activeMenu, setActiveMenu] = useState<MenuId | null>(null);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // A pointer press anywhere outside the bar closes it, and Escape does too — the two
  // ways every menu bar closes. Bound only while something is open.
  useEffect(() => {
    if (openMenu === null) return undefined;
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpenMenu(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  // Opening a menu also claims the tab stop, so Escape has a trigger to return to and a
  // later Tab leaves from where the user actually was.
  const openMenuAndFocus = useCallback((id: MenuId | null) => {
    setOpenMenu(id);
    if (id !== null) setActiveMenu(id);
  }, []);

  const packagedOpen = useCallback(() => fileInputRef.current?.click(), []);

  const packagedSave = useCallback(() => {
    if (!editor) return;
    // `Editor.save()` REJECTS when there is no document to serialize, and the parser's own
    // refusals (zip bomb, oversized part) surface the same way. Swallowing that leaves the
    // user with no download and no error — they conclude it worked. The rejection is
    // reported through the same channel a host's `onChange` uses.
    void editor
      .save()
      .then((buffer) => download(buffer, downloadName(fileName)))
      .catch((error: unknown) => {
        console.error('[docx-editor] save failed', error);
      });
  }, [editor, fileName]);

  const packagedPageSetup = useCallback(() => setPageSetupOpen(true), []);

  // The resolved actions, host override first. Each is undefined without an editor, which
  // is what disables the row before the document is ready.
  const resolvedOpen = editor ? (onOpen ?? packagedOpen) : undefined;
  const resolvedSave = editor ? (onSave ?? packagedSave) : undefined;
  const resolvedPageSetup = editor ? (onPageSetup ?? packagedPageSetup) : undefined;

  // Ctrl/Cmd+O and Ctrl/Cmd+S, so the shortcut column tells the truth. Both are what the
  // browser would otherwise handle (open a local file, save the page), and an editor that
  // leaves Cmd+S to the browser is the surprising one.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== 's' && key !== 'o') return;
      // SCOPED to this editor. A document-level listener that fires wherever focus happens
      // to be means an embedded editor eats the host page's Cmd+S while the user types in
      // an unrelated field, and two mounted editors both answer one keypress. The shortcut
      // belongs to the editor the user is actually in: the chrome, the painted surface, or
      // anything else under this instance's root.
      // `.ep-root` is the library's own scope class and wraps the whole editor — chrome,
      // viewport and painted pages — so one containment test covers the bar AND the
      // document. A composition that does not use it falls back to the bar's own subtree,
      // which is narrow but never wrong.
      const target = event.target as Node | null;
      const scope = rootRef.current?.closest('.ep-root') ?? rootRef.current;
      if (!target || !scope?.contains(target)) return;
      if (key === 's' && resolvedSave) {
        event.preventDefault();
        resolvedSave();
      } else if (key === 'o' && resolvedOpen) {
        event.preventDefault();
        resolvedOpen();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [resolvedOpen, resolvedSave]);

  const context = useMemo<MenuContextValue>(
    () => ({
      t,
      openMenu,
      setOpenMenu: openMenuAndFocus,
      activeMenu,
      onOpen: resolvedOpen,
      onSave: resolvedSave,
      onPageSetup: resolvedPageSetup,
      onReportIssue,
      reportIssue,
    }),
    [
      t,
      openMenu,
      openMenuAndFocus,
      activeMenu,
      resolvedOpen,
      resolvedSave,
      resolvedPageSetup,
      onReportIssue,
      reportIssue,
    ]
  );

  let content: ReactNode;
  if (!preset) {
    content = children;
  } else {
    const overrides = new Map<ChromeMenuId, ReactElement>();
    const appended: ReactNode[] = [];
    for (const child of Children.toArray(children)) {
      const id = menuOfChild(child);
      // Last override for a menu wins, matching how later props win in a spread.
      if (id) overrides.set(id, child as ReactElement);
      else appended.push(child);
    }
    content = (
      <>
        {CHROME_MENUS.map((menu) => {
          const override = overrides.get(menu.id);
          if (override) return <Fragment key={menu.id}>{override}</Fragment>;
          const Part = MENU_PARTS[menu.id];
          return <Part key={menu.id} />;
        })}
        {appended}
      </>
    );
  }

  return (
    <MenuContext.Provider value={context}>
      <div
        ref={(node) => {
          rootRef.current = node;
          // Seed the tab stop on the first RENDERED menu rather than on the registry's
          // first: a bar whose File menu was hidden would otherwise have its only tab stop
          // on an element that does not exist, and be unreachable by keyboard.
          if (node && activeMenu === null) {
            const first = barTriggers(node)[0]?.closest('[data-menu]')?.getAttribute('data-menu');
            if (first) setActiveMenu(first);
          }
        }}
        role="menubar"
        // Named, because a host page can carry its own menubar beside the editor's and
        // "menu bar" twice tells a screen-reader user nothing about which is which.
        aria-label={(t ?? ((key: string) => key))('titleBar.menuBarAriaLabel')}
        data-testid="docx-menubar"
        className={`docx-menubar${className ? ` ${className}` : ''}`}
        // Container-level caret guard (CLAUDE.md focus-stealing pitfall): a disabled row
        // never receives mousedown, so per-row handlers cannot cover it.
        onMouseDown={guardToolbarMousedown}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          const bar = rootRef.current;
          if (!bar) return;
          // Only the BAR's own arrows. Inside an open panel, Left/Right belong to the
          // submenu contract and the panel has already stopped them.
          const triggers = barTriggers(bar);
          const index = triggers.indexOf(document.activeElement as HTMLElement);
          if (index === -1) return;
          event.preventDefault();
          const step = event.key === 'ArrowRight' ? 1 : -1;
          const next = triggers[(index + step + triggers.length) % triggers.length];
          const id = next?.closest('[data-menu]')?.getAttribute('data-menu');
          if (!id) return;
          setActiveMenu(id);
          next?.focus();
          // Docs' behaviour: arrowing along an OPEN bar keeps browsing the panels.
          if (openMenu !== null) setOpenMenu(id);
        }}
      >
        {content}
      </div>
      {/* Opening a document is a FILE READ the user drives — never a fetched URL. Mounted
          even when the host overrode `onOpen`, because the input costs nothing and a host
          that later drops the override keeps working. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the SAME file twice fires a change event again.
          event.target.value = '';
          if (!file || !editor) return;
          // A read or a parse can fail — a revoked file handle, or the package guards
          // refusing a zip bomb. Reporting it beats a silent no-op that leaves the previous
          // document painted and the user believing the new one opened.
          void file
            .arrayBuffer()
            .then((buffer) => editor.load(new Uint8Array(buffer)))
            .catch((error: unknown) => {
              console.error('[docx-editor] could not open the file', error);
            });
        }}
      />
      {/* The packaged Page Setup dialog. A host that passed `onPageSetup` never opens it. */}
      <DocxEditorPageSetupDialog open={pageSetupOpen} onClose={() => setPageSetupOpen(false)} />
    </MenuContext.Provider>
  );
}

/** The menu bar with its parts attached as statics. @public */
export interface DocxEditorMenuNamespace {
  (props: DocxEditorMenuProps): ReactNode;
  /** A menu of the bar, addressed by registry id. */
  readonly Menu: typeof Menu;
  readonly File: MenuPartComponent;
  readonly Format: MenuPartComponent;
  readonly Insert: MenuPartComponent;
  readonly Help: MenuPartComponent;
  /** One chrome slot as a live row. */
  readonly Item: typeof MenuItem;
  /** A presentational row, for a host action that is not a chrome slot. */
  readonly Row: typeof MenuRow;
  readonly Separator: typeof MenuSeparator;
  readonly Submenu: typeof MenuSubmenu;
  /** Word's 6×6 insert-table size picker. */
  readonly TableGrid: typeof MenuTableGrid;
  /** One registry entry as its row, for a host arranging registry data itself. */
  readonly Entry: typeof MenuEntry;
  readonly Open: typeof MenuOpen;
  readonly Save: typeof MenuSave;
  readonly PageSetup: typeof MenuPageSetup;
  /** Help › Report issue, so a host can drop it or point it elsewhere by name. */
  readonly ReportIssue: typeof MenuReportIssue;
}

/**
 * The compound menu bar: `<DocxEditor.Menu/>` for File · Format · Insert · Help, parts as
 * statics for composition.
 *
 * Every actionable row is a chrome slot, so a row and its toolbar twin share one label,
 * one icon, one command and one enabled state. Rows the engine cannot honour yet render
 * present and disabled, carrying the engine's own reason.
 *
 * @public
 */
export const DocxEditorMenu: DocxEditorMenuNamespace = Object.assign(DocxEditorMenuRoot, {
  Menu,
  File: MenuFile,
  Format: MenuFormat,
  Insert: MenuInsert,
  Help: MenuHelp,
  Item: MenuItem,
  Row: MenuRow,
  Separator: MenuSeparator,
  Submenu: MenuSubmenu,
  TableGrid: MenuTableGrid,
  Entry: MenuEntry,
  Open: MenuOpen,
  Save: MenuSave,
  PageSetup: MenuPageSetup,
  ReportIssue: MenuReportIssue,
});
