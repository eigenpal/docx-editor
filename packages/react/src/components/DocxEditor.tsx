import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import { prefersColorSchemeDark, resolveIsDark, subscribeSystemDark } from '../lib/colorMode';
import { useDocxEditor } from '../editor/context';
import { DocxEditorContent } from '../editor/DocxEditorContent';
import { DocxEditorLoading } from '../editor/DocxEditorLoading';
import { DocxEditorRoot } from '../editor/DocxEditorRoot';
import { DocxEditorViewport } from '../editor/DocxEditorViewport';
import { useDocxEditorRefApi } from './DocxEditor/hooks/useDocxEditorRefApi';
import { DocxEditorToolbar } from '../editor/toolbar';
import { DocxEditorMenu } from '../editor/menu';
import { DocxEditorHorizontalRuler, DocxEditorVerticalRuler } from '../editor/DocxEditorRulers';
import { DocxEditorDocumentOutline } from '../editor/DocxEditorOutline';
import { Navigation as DocxEditorNavigationCompound } from '../editor/navigation';
import { DocxEditorPageSetupDialog } from '../editor/DocxEditorPageSetup';
import { DocxEditorReview } from '../editor/DocxEditorReview';
import { DocxEditorHeaderFooterChrome } from '../editor/DocxEditorHeaderFooter';
import { DocxEditorHyperLink } from '../editor/DocxEditorHyperLink';
import { DocxEditorNotesChrome } from '../editor/DocxEditorNotes';
import {
  ContextMenu as DocxEditorContextMenuCompound,
  DocxEditorContextMenu,
} from '../editor/contextmenu';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { DocxEditorProps, DocxEditorRef } from '../types';

/**
 * React host for the docx editor: the batteries-included entry point.
 *
 * `<DocxEditor document={bytes} />` is a complete editor — chrome, English labels, and a
 * painted editable document — with no further configuration. Everything below is about
 * what you can change, not what you must supply.
 *
 * SUGAR OVER THE PRIMITIVES, not a parallel implementation. `DocxEditor.Root` owns the
 * facade's lifetime, `DocxEditor.Viewport` is the scroll container, `DocxEditor.Content`
 * is the mount point the engine paints pages into. This component composes exactly those
 * three plus the title bar, the toolbar, and the imperative ref bridge, so a host that
 * outgrows the packaged chrome drops to those same primitives with no behavior change.
 *
 * LABELS default to the bundled English catalogue: `useTranslation()` reads
 * `LocaleContext`, whose default value is `en`. Strings still come from
 * `packages/i18n/en.json` rather than literals in components — the default only decides
 * who resolves the key. Pass `t` to resolve them yourself.
 *
 * That is deliberately the opposite default from the bare `DocxEditor.Toolbar` primitive,
 * which shows the raw key when given no `t`. A primitive stays neutral; the one-line
 * entry point should just work.
 *
 * `chrome={false}` renders the painted surface alone, for hosts that bring their own.
 */

/**
 * Chrome geometry: the column that fills the host box, and a scroll container that is
 * the flex child allowed to shrink
 * (`minHeight/minWidth: 0`) — without that the page stack stops scrolling and the
 * window scrolls instead.
 */
const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  backgroundColor: 'var(--doc-bg)',
};

const SCROLL_AREA_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowAnchor: 'none',
};

/**
 * The workspace row: the positioning context an overlay pane anchors to, wrapped around
 * the scroll container. `position: relative` is load-bearing — the navigation pane is
 * absolutely positioned against this box's left edge.
 */
const WORKSPACE_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

const TITLE_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderBottom: '1px solid var(--doc-border)',
  backgroundColor: 'var(--doc-surface)',
  color: 'var(--doc-text)',
};

/**
 * Title over menus, the way Word and Docs stack them: the document's name identifies what
 * you are looking at, the menu bar acts on it. They share a column so the left slot (a
 * logo) and the right slot (host actions) span both rows.
 */
const TITLE_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  gap: 2,
};

const TITLE_INPUT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  font: 'inherit',
  color: 'inherit',
  backgroundColor: 'transparent',
  border: '1px solid transparent',
  borderRadius: 4,
  padding: '2px 6px',
};

/**
 * Bridges the context-published editor into the seven-member imperative handle. A
 * child of `Root` rather than logic in the sugar component, so the handle reads the
 * SAME instance every other consumer sees.
 */
function DocxEditorRefBridge({ forwardedRef }: { forwardedRef: React.Ref<DocxEditorRef> }) {
  const editor = useDocxEditor();
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  useDocxEditorRefApi({ ref: forwardedRef, editorRef });
  return null;
}

const DocxEditorImpl = forwardRef<DocxEditorRef, DocxEditorProps>(function DocxEditor(props, ref) {
  const {
    document: doc,
    fonts,
    className,
    t,
    chrome = true,
    title,
    onTitleChange,
    renderTitleBarLeft,
    renderTitleBarRight,
    colorMode = 'light',
    author,
    locale,
    mode,
    zoom,
    onReady,
    onChange,
    onFontError,
    onOpen,
    onSave,
    hyperlinkPopup,
    contextMenu = true,
    menu = true,
    navigation = true,
  } = props;

  // Chrome colour mode: 'system' subscribes to the OS setting. Only the chrome
  // root's `.dark` class moves — the
  // document canvas stays Word-faithful.
  const [systemDark, setSystemDark] = useState(prefersColorSchemeDark);
  useEffect(() => {
    if (colorMode !== 'system') return undefined;
    return subscribeSystemDark(setSystemDark);
  }, [colorMode]);
  const isDark = resolveIsDark(colorMode, systemDark);

  // Label resolution, in precedence order: the host's `t`, else the active
  // `LocaleContext` catalogue (bundled English unless a provider swapped it).
  //
  // The fallback is a `useCallback` rather than an inline arrow because the toolbar
  // memoizes its context value on `t`'s identity. A fresh closure per render would miss
  // that memo and re-render all two dozen toolbar slots on every host render — which is
  // the common case, since a host holding `title` in state re-renders on every keystroke
  // in the title input. `catalogT` is already stable per catalogue and language.
  //
  // The cast bridges the two signatures: `TFunction` is keyed by the `TranslationKey`
  // union derived from `en.json`, while the prop takes a plain `string` so a host can
  // supply any resolver. Every key this component passes is a real catalogue key.
  const { t: catalogT } = useTranslation();
  const fallbackT = useCallback((key: string) => catalogT(key as TranslationKey), [catalogT]);
  const translate = t ?? fallbackT;

  // The painted document: the primitive Viewport (scroll container, load-bearing
  // classes) around the primitive Content (the engine's mount point). Chrome-off
  // hosts get the caller's className on the viewport itself; chrome-on hosts theme
  // the viewport with `dark` and put the className on the chrome wrapper below.
  // The link popover mounts INSIDE the viewport, so ordinary CSS keeps it attached to the
  // page while the user scrolls — no scroll listener, no per-frame reposition. It renders
  // nothing until a link click or Ctrl/Cmd+K opens it, and `hyperlinkPopup={false}` drops
  // the packaged panel while leaving the engine's gestures wired for a host's own UI.
  const viewport = (
    <DocxEditorViewport
      className={chrome ? (isDark ? 'dark' : undefined) : className}
      style={chrome ? SCROLL_AREA_STYLE : undefined}
    >
      {chrome ? <DocxEditorHeaderFooterChrome /> : null}
      {chrome ? <DocxEditorNotesChrome /> : null}
      <DocxEditorContent />
      <DocxEditorHyperLink hidden={hyperlinkPopup === false} />
      {contextMenu === false ? null : (
        <DocxEditorContextMenu
          t={translate}
          {...(typeof contextMenu === 'object' ? contextMenu : {})}
        />
      )}
    </DocxEditorViewport>
  );

  const tree = chrome ? (
    <div
      className={`ep-root${isDark ? ' dark' : ''}${className ? ` ${className}` : ''}`}
      style={CONTAINER_STYLE}
    >
      <div style={TITLE_BAR_STYLE}>
        {renderTitleBarLeft?.()}
        <div style={TITLE_BLOCK_STYLE}>
          {onTitleChange ? (
            <input
              aria-label={translate('titleBar.documentNameAriaLabel')}
              value={title ?? ''}
              placeholder={translate('titleBar.untitled')}
              onChange={(event) => onTitleChange(event.target.value)}
              style={TITLE_INPUT_STYLE}
            />
          ) : (
            <span style={{ minWidth: 0, padding: '2px 6px' }}>
              {title ?? translate('titleBar.untitled')}
            </span>
          )}
          {/* File · Format · Insert · Help. Every row is a chrome slot, so it shares its
              label, icon and enabled state with the toolbar control for the same
              capability. Open and Save work with no configuration; `onOpen`/`onSave`
              replace them. */}
          {menu !== false ? (
            <DocxEditorMenu
              t={translate}
              {...(title !== undefined ? { fileName: title } : {})}
              {...(onOpen ? { onOpen } : {})}
              {...(onSave ? { onSave } : {})}
              // An object `menu` is menu props, spread LAST so a host's own handler wins
              // over the ones derived from the top-level props above.
              {...(typeof menu === 'object' ? menu : {})}
            />
          ) : null}
        </div>
        {onSave ? (
          <button
            type="button"
            onClick={() => onSave()}
            style={{
              font: 'inherit',
              color: 'inherit',
              backgroundColor: 'var(--doc-bg-input)',
              border: '1px solid var(--doc-border-input)',
              borderRadius: 4,
              padding: '2px 10px',
              cursor: 'pointer',
            }}
          >
            {translate('common.save')}
          </button>
        ) : null}
        {renderTitleBarRight?.()}
      </div>
      {/* Save is deliberately absent here: the registry marks the `file` group contextual,
          so `defaultChromeGroups()` filters it out and only explicit composition mounts it.
          The title bar above carries the save control instead. */}
      <DocxEditorToolbar t={translate} />
      {/* The navigation pane is a SIBLING of the viewport inside a positioned row, not a
          column beside it: it floats over the gutter to the left of the centred page and
          leaves the page alone until the window is too narrow to hold both. Without a
          pane this wrapper is an inert flex row around the same viewport. */}
      <div style={WORKSPACE_STYLE}>
        {navigation ? <DocxEditorNavigationCompound t={translate} /> : null}
        {viewport}
      </div>
    </div>
  ) : (
    viewport
  );

  // Root owns the facade: created once per document/fonts identity, zoom follows
  // through `setZoom`, callbacks are read at their latest identity.
  return (
    <DocxEditorRoot
      {...(doc !== undefined ? { document: doc } : {})}
      {...(fonts ? { fonts } : {})}
      {...(author !== undefined ? { author } : {})}
      {...(locale !== undefined ? { locale } : {})}
      {...(mode !== undefined ? { mode } : {})}
      {...(zoom !== undefined ? { zoom } : {})}
      {...(onReady ? { onReady } : {})}
      {...(onChange ? { onChange } : {})}
      {...(onFontError ? { onFontError } : {})}
    >
      <DocxEditorRefBridge forwardedRef={ref} />
      {tree}
    </DocxEditorRoot>
  );
});

/**
 * The composed editor component with its composition primitives attached as statics,
 * so `<DocxEditor.Root>`, `<DocxEditor.Viewport>`, and `<DocxEditor.Content>` work
 * without extra imports.
 *
 * @public
 */
export interface DocxEditorNamespace extends ForwardRefExoticComponent<
  DocxEditorProps & RefAttributes<DocxEditorRef>
> {
  readonly Root: typeof DocxEditorRoot;
  readonly Viewport: typeof DocxEditorViewport;
  readonly Content: typeof DocxEditorContent;
  readonly Toolbar: typeof DocxEditorToolbar;
  /**
   * The menu bar — File · Format · Insert · Help — with its parts as statics (`.File`,
   * `.Format`, `.Insert`, `.Help`, `.Item`, `.Row`, `.Submenu`, `.TableGrid`, …). Mounted
   * by default under the title; `menu={false}` removes it.
   */
  readonly Menu: typeof DocxEditorMenu;
  /** Conditional loading screen: renders while there is no document to paint. */
  readonly Loading: typeof DocxEditorLoading;
  /** Context-fed horizontal ruler with draggable margins (props-driven export stays). */
  readonly HorizontalRuler: typeof DocxEditorHorizontalRuler;
  /** Context-fed vertical ruler with draggable margins (props-driven export stays). */
  readonly VerticalRuler: typeof DocxEditorVerticalRuler;
  /** Context-fed heading outline over `Editor.getOutline()`. */
  readonly DocumentOutline: typeof DocxEditorDocumentOutline;
  /**
   * The navigation pane — Headings and Find — with its parts as statics (`.Header`,
   * `.Close`, `.Title`, `.Tabs`, `.Tab`, `.Headings`, `.Find`, `.Toggle`). Mounted by
   * default; `navigation={false}` removes it.
   */
  readonly Navigation: typeof DocxEditorNavigationCompound;
  /** Page Setup dialog — size, orientation, margins — applied as one undo step. */
  readonly PageSetupDialog: typeof DocxEditorPageSetupDialog;
  /** Header/footer scope chrome while editing page furniture. */
  readonly HeaderFooterChrome: typeof DocxEditorHeaderFooterChrome;
  readonly NotesChrome: typeof DocxEditorNotesChrome;
  /**
   * The link popover — target readout, copy, edit, unlink — and its parts. Mounted by
   * default inside the viewport; `hyperlinkPopup={false}` removes it.
   */
  readonly HyperLink: typeof DocxEditorHyperLink;
  /**
   * The review rail — tracked changes and comments as cards beside the page, with accept,
   * reject and reply. Place it inside the Viewport, beside `DocxEditor.Content`.
   */
  readonly Review: typeof DocxEditorReview;
  /**
   * The right-click menu over the painted document, with its rows as statics (`.Cut`,
   * `.Copy`, `.Paste`, `.Delete`, `.SelectAll`, `.Item`, `.Slot`, `.Submenu`, …). Mounted
   * by default inside the viewport; `contextMenu={false}` removes it and lets the
   * browser's own menu through.
   */
  readonly ContextMenu: typeof DocxEditorContextMenuCompound;
}

export const DocxEditor: DocxEditorNamespace = Object.assign(DocxEditorImpl, {
  Root: DocxEditorRoot,
  Viewport: DocxEditorViewport,
  Content: DocxEditorContent,
  Toolbar: DocxEditorToolbar,
  Menu: DocxEditorMenu,
  Loading: DocxEditorLoading,
  HorizontalRuler: DocxEditorHorizontalRuler,
  VerticalRuler: DocxEditorVerticalRuler,
  DocumentOutline: DocxEditorDocumentOutline,
  Navigation: DocxEditorNavigationCompound,
  PageSetupDialog: DocxEditorPageSetupDialog,
  HeaderFooterChrome: DocxEditorHeaderFooterChrome,
  NotesChrome: DocxEditorNotesChrome,
  HyperLink: DocxEditorHyperLink,
  Review: DocxEditorReview,
  ContextMenu: DocxEditorContextMenuCompound,
});
