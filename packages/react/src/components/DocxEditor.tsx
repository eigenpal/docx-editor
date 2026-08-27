import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { prefersColorSchemeDark, resolveIsDark, subscribeSystemDark } from '../lib/colorMode';
import { useDocxEditor } from '../editor/context';
import { DocxEditorContent } from '../editor/DocxEditorContent';
import { DocxEditorLoading } from '../editor/DocxEditorLoading';
import {
  DocxEditorAuthorStyle,
  DocxEditorColorByChangeType,
} from '../editor/DocxEditorAuthorStyle';
import { DocxEditorRoot } from '../editor/DocxEditorRoot';
import { DocxEditorViewport } from '../editor/DocxEditorViewport';
import { useDocxEditorRefApi } from './DocxEditor/hooks/useDocxEditorRefApi';
import { DocxEditorToolbar } from '../editor/toolbar';
import { DocxEditorMenu } from '../editor/menu';
import { DocxEditorHorizontalRuler, DocxEditorVerticalRuler } from '../editor/DocxEditorRulers';
import { DocxEditorDocumentOutline } from '../editor/DocxEditorOutline';
import { Navigation as DocxEditorNavigationCompound } from '../editor/navigation';
import { DocxEditorPageSetupDialog } from '../editor/DocxEditorPageSetup';
import { DocxEditorParagraphDialog } from '../editor/DocxEditorParagraphDialog';
import { DocxEditorPageNumber, PageNumberTranslationContext } from '../editor/DocxEditorPageNumber';
import { DocxEditorFontNotice } from '../editor/DocxEditorFontNotice';
import { DocxEditorHeaderFooterChrome } from '../editor/DocxEditorHeaderFooter';
import { DocxEditorHyperLink } from '../editor/DocxEditorHyperLink';
import { DocxEditorEquation } from '../editor/DocxEditorEquation';
import { DocxEditorNotesChrome } from '../editor/DocxEditorNotes';
import {
  ContextMenu as DocxEditorContextMenuCompound,
  DocxEditorContextMenu,
} from '../editor/contextmenu';
import { DocxEditorContentControl } from '../editor/DocxEditorContentControl';
import { LocaleProvider, useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { DocxEditorProps, DocxEditorRef } from '../types';
import { ScopedByAncestorContext } from '../editor/scope-context';

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

/**
 * The ruler's row. It sits between the toolbar and the scroll container, which
 * is the only place the part measures correctly: it applies the navigation
 * shift and the review gutter itself, so it has to be OUTSIDE the viewport that
 * already reserves them.
 *
 * `min-height` holds the row open before a document is loaded — the ruler draws
 * nothing without a page, and letting the row collapse made the page stack jump
 * when the ticks appeared.
 *
 * A block, NOT a flex row with `justify-content: center`: the ruler part centres
 * itself clamp-safely (see `HorizontalRuler`'s base style), so on narrow screens
 * it pins to the start edge like the page instead of overflowing both sides and
 * losing its left inches to `overflow: hidden`.
 *
 * `scrollbar-gutter` mirrors the scroll container below, which reserves the same
 * symmetric gutter — without it, on classic-scrollbar platforms the clamped page
 * pins a gutter-width right of the clamped ruler.
 */
const RULER_ROW_STYLE: CSSProperties = {
  flex: 'none',
  minHeight: 34,
  padding: '6px 0 2px',
  overflow: 'hidden',
  scrollbarGutter: 'stable both-edges',
  backgroundColor: 'var(--doc-bg)',
};

const VERTICAL_RULER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 40,
  left: 0,
  zIndex: 10,
  pointerEvents: 'none',
};

/**
 * The chrome band: title bar and toolbar on ONE `--doc-surface` surface, closed by a
 * seam (hairline + soft shadow) directly under the toolbar. The ruler row and the
 * workspace below sit on the gray `--doc-bg`, which is what makes the band read as a
 * single piece of chrome rather than a white title bar with a toolbar loose on the
 * workspace.
 *
 * The seam belongs HERE and not on the title bar: a border under the title bar cuts
 * the band in two and leaves the toolbar with no ground of its own.
 *
 * `z-index` lifts the seam's shadow over the workspace, and the menus that open from
 * this row stack inside its context, above everything below. The band is a stacking
 * context, so it caps every popup inside it: it must sit in the overlay band, or the
 * navigation pane (chrome band, 40) paints over every menu the toolbar opens.
 */
const CHROME_BAND_STYLE: CSSProperties = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  zIndex: 'var(--doc-z-overlay)',
  backgroundColor: 'var(--doc-surface)',
  // Longhand on purpose: the `border-bottom` shorthand does not survive a var()
  // in every DOM implementation the suite runs against.
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderBottomColor: 'var(--doc-border)',
  boxShadow: '0 1px 3px var(--doc-shadow-subtle)',
};

/**
 * Insets the toolbar inside the band. The toolbar paints its own pill
 * (`.docx-toolbar` is a rounded `--doc-bg-subtle` slab); flush against the band's
 * edges that pill has nothing to sit on and its radius never shows, so the row reads
 * as a second flat bar under the title.
 */
const TOOLBAR_ROW_STYLE: CSSProperties = {
  padding: '8px 12px',
};

const TITLE_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px 0',
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

/**
 * The frame itself. Separated from the exported component only so the `i18n` prop can
 * publish its catalogue ABOVE this body: `useTranslation()` below reads the context its
 * caller renders in, so a provider inside this function would not reach its own labels.
 */
const DocxEditorFrame = forwardRef<DocxEditorRef, DocxEditorProps>(
  function DocxEditorFrame(props, ref) {
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
      // The packaged editor opens ready to type, even when the file's `w:trackRevisions`
      // asks for suggesting — the sugar's opinionated default. `DocxEditor.Root` stays
      // neutral and follows the document's request when given no mode.
      mode = 'edit',
      modules,
      zoom,
      zoomMode,
      onReady,
      onChange,
      onFontError,
      onOpen,
      onSave,
      hyperlinkPopup,
      contextMenu = true,
      menu = true,
      navigation = true,
      rulers = true,
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
    const translate = useCallback(
      (key: string, params?: Record<string, string | number>) =>
        t ? t(key, params) : catalogT(key as TranslationKey, params),
      [t, catalogT]
    );

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
        <DocxEditorEquation />
        {contextMenu === false ? null : (
          <DocxEditorContextMenu
            t={translate}
            {...(typeof contextMenu === 'object' ? contextMenu : {})}
          />
        )}
        <DocxEditorContentControl />
        {/* The vertical ruler scrolls WITH the document, so unlike its horizontal
          twin it belongs inside the scroller. aria-hidden: it carries no
          operable handles, unlike the horizontal one's indent sliders. */}
        {rulers && chrome ? (
          <div style={VERTICAL_RULER_STYLE} aria-hidden="true">
            <DocxEditorVerticalRuler />
          </div>
        ) : null}
        {props.children}
      </DocxEditorViewport>
    );

    const tree = chrome ? (
      // This wrapper carries the scope class, so the chrome parts below it must
      // not add their own — see editor/scope-context.ts.
      <div
        className={`docx-editor${isDark ? ' dark' : ''}${className ? ` ${className}` : ''}`}
        style={CONTAINER_STYLE}
      >
        {/* Title bar and toolbar share one surface, closed by the seam under the
          toolbar — see CHROME_BAND_STYLE. */}
        <div style={CHROME_BAND_STYLE}>
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
            {renderTitleBarRight?.()}
          </div>
          {/* Save is deliberately absent here: the registry marks the `file` group contextual,
            so `defaultChromeGroups()` filters it out and only explicit composition mounts it.
            File -> Save in the menu bar carries it. */}
          <div style={TOOLBAR_ROW_STYLE}>
            <DocxEditorToolbar t={translate} />
          </div>
        </div>
        {/* The ruler belongs to the packaged frame: every editor this component is
          modelled on shows one, and a host that had to mount it by hand got the
          placement wrong — the part compensates for the review gutter itself, so
          inside the scroll container that reservation is counted twice and the
          ticks drift off the page they measure. It has to sit ABOVE the
          scroller, which is a slot only this component can offer. */}
        {rulers ? (
          <div style={RULER_ROW_STYLE} data-testid="docx-editor-ruler-row">
            <DocxEditorHorizontalRuler />
          </div>
        ) : null}
        {/* Word's font compatibility bar: shown when the document's declared faces render
          in substitutes, dismissible per set of missing families. */}
        <DocxEditorFontNotice t={translate} />
        {/* The navigation pane is a SIBLING of the viewport inside a positioned row, not a
          column beside it: it floats over the gutter to the left of the centred page and
          leaves the page alone until the window is too narrow to hold both. Without a
          pane this wrapper is an inert flex row around the same viewport. */}
        <div style={WORKSPACE_STYLE}>
          {navigation ? <DocxEditorNavigationCompound t={translate} /> : null}
          {viewport}
          <PageNumberTranslationContext.Provider value={translate}>
            <DocxEditorPageNumber />
          </PageNumberTranslationContext.Provider>
          {/* The packaged loading screen, pinned over the workspace (this row is the
            positioned ancestor). It shows before a document arrives AND while a large
            one opens — the engine mounts big files behind one painted frame so this
            overlay can paint instead of the page freezing — and renders nothing
            otherwise, so it costs the loaded editor nothing. */}
          <DocxEditorLoading overlay />
        </div>
      </div>
    ) : (
      viewport
    );

    const tableInteractionLabel = useCallback(
      (key: 'table.insertRowBelow' | 'table.insertColumnRight') => translate(key),
      [translate]
    );

    // Root owns the facade: created once per document/fonts identity, zoom follows
    // through `setZoom`, callbacks are read at their latest identity.
    return (
      <DocxEditorRoot
        {...(doc !== undefined ? { document: doc } : {})}
        {...(fonts ? { fonts } : {})}
        {...(author !== undefined ? { author } : {})}
        {...(locale !== undefined ? { locale } : {})}
        translate={translate}
        mode={mode}
        {...(modules !== undefined ? { modules } : {})}
        {...(zoom !== undefined ? { zoom } : {})}
        {...(zoomMode !== undefined ? { zoomMode } : {})}
        tableInteractionLabel={tableInteractionLabel}
        {...(onReady ? { onReady } : {})}
        {...(onChange ? { onChange } : {})}
        {...(onFontError ? { onFontError } : {})}
      >
        <DocxEditorRefBridge forwardedRef={ref} />
        {/* Only the chrome branch renders a wrapper carrying `.docx-editor`.
          With `chrome={false}` there is none, so the parts must self-scope. */}
        <ScopedByAncestorContext.Provider value={chrome}>{tree}</ScopedByAncestorContext.Provider>
      </DocxEditorRoot>
    );
  }
);

/**
 * The frame, under the catalogue its `i18n` prop selects.
 *
 * The provider is unconditional: with no `i18n` it publishes the catalogue it inherits,
 * so a host that wraps the app in its own `LocaleProvider` still reaches this chrome and
 * an `i18n` here overrides that for this editor only.
 */
const DocxEditorImpl = forwardRef<DocxEditorRef, DocxEditorProps>(function DocxEditor(props, ref) {
  return (
    <LocaleProvider {...(props.i18n !== undefined ? { i18n: props.i18n } : {})}>
      <DocxEditorFrame {...props} ref={ref} />
    </LocaleProvider>
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
  readonly ColorByChangeType: typeof DocxEditorColorByChangeType;
  readonly AuthorStyle: typeof DocxEditorAuthorStyle;
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
  /** The Paragraph dialog: alignment, indentation, spacing and the paragraph flags. */
  readonly ParagraphDialog: typeof DocxEditorParagraphDialog;
  /** Floating localized page readout for the active viewport. */
  readonly PageNumber: typeof DocxEditorPageNumber;
  /** Word-style notice when document fonts render in substitute faces. */
  readonly FontNotice: typeof DocxEditorFontNotice;
  /** Header/footer scope chrome while editing page furniture. */
  readonly HeaderFooterChrome: typeof DocxEditorHeaderFooterChrome;
  readonly NotesChrome: typeof DocxEditorNotesChrome;
  /** The default linear-math popover for a clicked Office Math equation. */
  readonly Equation: typeof DocxEditorEquation;
  /**
   * The link popover — target readout, copy, edit, unlink — and its parts. Mounted by
   * default inside the viewport; `hyperlinkPopup={false}` removes it.
   */
  readonly HyperLink: typeof DocxEditorHyperLink;
  /**
   * The right-click menu over the painted document, with its rows as statics (`.Cut`,
   * `.Copy`, `.Paste`, `.Delete`, `.SelectAll`, `.Item`, `.Slot`, `.Submenu`, …). Mounted
   * by default inside the viewport; `contextMenu={false}` removes it and lets the
   * browser's own menu through.
   */
  readonly ContextMenu: typeof DocxEditorContextMenuCompound;
  /**
   * The content-control inspector — alias, tag, type, lock, placeholder, bound — and
   * remove-keeping-content. Mounted by default inside the viewport; opens from the
   * `contentControl.inspector` chrome slot.
   */
  readonly ContentControl: typeof DocxEditorContentControl;
}

export const DocxEditor: DocxEditorNamespace = Object.assign(DocxEditorImpl, {
  Root: DocxEditorRoot,
  Viewport: DocxEditorViewport,
  Content: DocxEditorContent,
  Toolbar: DocxEditorToolbar,
  Menu: DocxEditorMenu,
  Loading: DocxEditorLoading,
  ColorByChangeType: DocxEditorColorByChangeType,
  AuthorStyle: DocxEditorAuthorStyle,
  HorizontalRuler: DocxEditorHorizontalRuler,
  VerticalRuler: DocxEditorVerticalRuler,
  DocumentOutline: DocxEditorDocumentOutline,
  Navigation: DocxEditorNavigationCompound,
  PageSetupDialog: DocxEditorPageSetupDialog,
  ParagraphDialog: DocxEditorParagraphDialog,
  PageNumber: DocxEditorPageNumber,
  FontNotice: DocxEditorFontNotice,
  HeaderFooterChrome: DocxEditorHeaderFooterChrome,
  NotesChrome: DocxEditorNotesChrome,
  Equation: DocxEditorEquation,
  HyperLink: DocxEditorHyperLink,
  ContextMenu: DocxEditorContextMenuCompound,
  ContentControl: DocxEditorContentControl,
});
