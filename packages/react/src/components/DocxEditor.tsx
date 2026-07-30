import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import { createTreeEditor } from '@docx-editor.dev/core-contract/editor';
import { prefersColorSchemeDark, resolveIsDark, subscribeSystemDark } from '../lib/colorMode';
import { useDocxEditorRefApi } from './DocxEditor/hooks/useDocxEditorRefApi';
import type { DocxEditorProps, DocxEditorRef } from '../types';

/**
 * React host for the tree-lane editor (phase 3 of the legacy-lane retirement).
 *
 * THIN, mirroring `PaginatedDocxEditor`: the host owns a container element, the facade's
 * lifetime, and prop-to-facade forwarding — nothing else. `createTreeEditor` implements
 * the full `Editor` contract over the engine-owned paginated surface, which paints its
 * own pages into the container and owns caret, selection, and hit testing internally, so
 * the adapter measures nothing, paints nothing, and derives no geometry.
 *
 * The legacy chrome forest under `./DocxEditor/` is written against the legacy display
 * pipeline — a host-DOM contract, engine-published display lists, interaction frames and
 * paint gates — none of which the tree lane publishes (the surface paints itself, and
 * the geometry cluster returns the typed empty frame). Rendering that chrome against
 * honest-empty stubs would show dead controls positioned on empty geometry, so a
 * `t`-supplied host gets the title bar (slots, editable name, save) above the surface.
 * chrome re-integration: phase 4 follow-up.
 */

/**
 * Legacy chrome geometry, kept from the previous host: the column that fills the host
 * box, and a scroll container that is the flex child allowed to shrink
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

export const DocxEditor = forwardRef<DocxEditorRef, DocxEditorProps>(
  function DocxEditor(props, ref) {
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
    } = props;

    const containerRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);

    // Latest props/callbacks, read inside effects without retriggering them.
    const propsRef = useRef(props);
    propsRef.current = props;

    // Create the facade once per document/fonts identity. `mode`, `locale`, `author`,
    // and the initial `zoom` are sampled at mount (as the prop docs say); later zoom
    // changes flow through `setZoom` below rather than a teardown, so undo history and
    // the caret survive parent re-renders.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return undefined;
      const p = propsRef.current;
      const editor = createTreeEditor({
        container,
        ...(p.document !== undefined ? { document: p.document } : {}),
        ...(p.fonts ? { fonts: p.fonts } : {}),
        ...(p.author !== undefined ? { author: p.author } : {}),
        ...(p.locale !== undefined ? { locale: p.locale } : {}),
        ...(p.mode !== undefined ? { mode: p.mode } : {}),
        ...(p.zoom !== undefined ? { zoom: p.zoom } : {}),
        onFontError: (error) => propsRef.current.onFontError?.(error),
      });
      editorRef.current = editor;
      const offChange = editor.on('change', (change) => propsRef.current.onChange?.(change));
      propsRef.current.onReady?.(editor);
      return () => {
        offChange();
        editor.destroy();
        editorRef.current = null;
      };
    }, [doc, fonts]);

    // Zoom is a facade parameter, not a remount: the stored factor applies from the
    // next mount the facade performs (see `TreeEditor.setZoom`), and tearing the
    // editor down for a zoom change would discard the user's edits and undo history.
    const propZoom = props.zoom;
    useEffect(() => {
      if (propZoom !== undefined) editorRef.current?.setZoom(propZoom);
    }, [propZoom]);

    // The seven-member imperative handle, each member forwarding to the facade.
    useDocxEditorRefApi({ ref, editorRef });

    // Chrome colour mode, resolved as the previous host resolved it: 'system'
    // subscribes to the OS setting. Only the chrome root's `.dark` class moves — the
    // document canvas stays Word-faithful.
    const [systemDark, setSystemDark] = useState(prefersColorSchemeDark);
    useEffect(() => {
      if (colorMode !== 'system') return undefined;
      return subscribeSystemDark(setSystemDark);
    }, [colorMode]);
    const isDark = resolveIsDark(colorMode, systemDark);

    const chromeOn = Boolean(t);

    // The painted document. `ep-root` scopes every --doc-* token; the viewport is the
    // sole scroll container; `docx-paginated-surface` carries the engine surface's
    // paper styling. The facade mounts its pages inside the inner element and owns
    // that subtree.
    const viewport = (
      <div
        data-testid="docx-editor-scroll"
        className={`ep-root ep-one-surface ep-one-surface__viewport${
          chromeOn && isDark ? ' dark' : ''
        }${!chromeOn && className ? ` ${className}` : ''}`}
        style={chromeOn ? SCROLL_AREA_STYLE : undefined}
      >
        <div
          ref={containerRef}
          className="docx-paginated-surface"
          style={{ margin: '24px auto' }}
        />
      </div>
    );

    if (!t) return viewport;

    return (
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
          {props.onSave ? (
            <button
              type="button"
              onClick={() => propsRef.current.onSave?.()}
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
        {viewport}
      </div>
    );
  }
);
