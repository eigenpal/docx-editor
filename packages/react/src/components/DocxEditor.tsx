import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import { prefersColorSchemeDark, resolveIsDark, subscribeSystemDark } from '../lib/colorMode';
import { useDocxEditor } from '../editor/context';
import { DocxEditorContent } from '../editor/DocxEditorContent';
import { DocxEditorRoot } from '../editor/DocxEditorRoot';
import { DocxEditorViewport } from '../editor/DocxEditorViewport';
import { useDocxEditorRefApi } from './DocxEditor/hooks/useDocxEditorRefApi';
import { DocxEditorToolbar } from '../editor/toolbar';
import { DocxEditorHorizontalRuler, DocxEditorVerticalRuler } from '../editor/DocxEditorRulers';
import { DocxEditorDocumentOutline } from '../editor/DocxEditorOutline';
import type { DocxEditorProps, DocxEditorRef } from '../types';

/**
 * React host for the docx editor.
 *
 * SUGAR over the composition primitives, not a parallel implementation:
 * `DocxEditor.Root` owns the facade's lifetime, `DocxEditor.Viewport` is the scroll
 * container, `DocxEditor.Content` is the mount point the engine paints pages into.
 * This component composes exactly those three (plus the optional `t`-gated title bar
 * and the imperative ref bridge), so a host that outgrows the packaged chrome drops
 * down to the same primitives without behavior change.
 *
 * CHROME IS OPT-IN VIA `t`. Every chrome label is an i18n key resolved through the host's
 * `t`; the adapter ships no English of its own, so without `t` there is nothing honest to
 * render and the component paints the bare document surface. That is a complete editor —
 * `<DocxEditor document={bytes} />` mounts, edits, and saves through the ref — and it is
 * the shape a host that brings its own chrome wants.
 *
 * With `t`, the packaged chrome renders: the title bar (slots, editable name, save) and
 * the full `DocxEditor.Toolbar` above the painted document. Hosts that outgrow it drop to
 * the same primitives (`Root` / `Viewport` / `Content` + the hooks) with no behavior change.
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

const TITLE_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderBottom: '1px solid var(--doc-border)',
  backgroundColor: 'var(--doc-surface)',
  color: 'var(--doc-text)',
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
    onSave,
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

  const chromeOn = Boolean(t);

  // The painted document: the primitive Viewport (scroll container, load-bearing
  // classes) around the primitive Content (the engine's mount point). Chrome-off
  // hosts get the caller's className on the viewport itself; chrome-on hosts theme
  // the viewport with `dark` and put the className on the chrome wrapper below.
  const viewport = (
    <DocxEditorViewport
      className={chromeOn ? (isDark ? 'dark' : undefined) : className}
      style={chromeOn ? SCROLL_AREA_STYLE : undefined}
    >
      <DocxEditorContent />
    </DocxEditorViewport>
  );

  const tree = t ? (
    <div
      className={`ep-root${isDark ? ' dark' : ''}${className ? ` ${className}` : ''}`}
      style={CONTAINER_STYLE}
    >
      <div style={TITLE_BAR_STYLE}>
        {renderTitleBarLeft?.()}
        {onTitleChange ? (
          <input
            aria-label={t('titleBar.documentNameAriaLabel')}
            value={title ?? ''}
            placeholder={t('titleBar.untitled')}
            onChange={(event) => onTitleChange(event.target.value)}
            style={TITLE_INPUT_STYLE}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, padding: '2px 6px' }}>
            {title ?? t('titleBar.untitled')}
          </span>
        )}
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
            {t('common.save')}
          </button>
        ) : null}
        {renderTitleBarRight?.()}
      </div>
      {/* The full chrome registry, default arrangement. `onSave` is forwarded so the
          toolbar's save control is live for the same hosts whose title bar shows one. */}
      <DocxEditorToolbar t={t} {...(onSave ? { onSave } : {})} />
      {viewport}
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
  /** Context-fed horizontal ruler (read-only; the props-driven export stays). */
  readonly HorizontalRuler: typeof DocxEditorHorizontalRuler;
  /** Context-fed vertical ruler (read-only; the props-driven export stays). */
  readonly VerticalRuler: typeof DocxEditorVerticalRuler;
  /** Context-fed heading outline over `Editor.getOutline()`. */
  readonly DocumentOutline: typeof DocxEditorDocumentOutline;
}

export const DocxEditor: DocxEditorNamespace = Object.assign(DocxEditorImpl, {
  Root: DocxEditorRoot,
  Viewport: DocxEditorViewport,
  Content: DocxEditorContent,
  Toolbar: DocxEditorToolbar,
  HorizontalRuler: DocxEditorHorizontalRuler,
  VerticalRuler: DocxEditorVerticalRuler,
  DocumentOutline: DocxEditorDocumentOutline,
});
