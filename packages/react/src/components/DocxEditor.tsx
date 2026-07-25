import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { InteractionIntent } from '@docx-editor.dev/core-contract/interaction';
import {
  attachAdapterEventBridge,
  createEditor,
  firstEditableGlyphTarget,
  measureInteractionHostMetrics,
  overlaysForFrame,
  type FrameOverlays,
  type GlyphClickTarget,
} from '@docx-editor.dev/engine-editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import clsx from 'clsx';
import { paintDisplay } from '../paintDisplay';
import { DocxEditorTitleBar } from './DocxEditor/DocxEditorTitleBar';
import { DocxEditorMenuBar } from './DocxEditor/DocxEditorMenuBar';
import { DocxEditorToolbar } from './DocxEditor/DocxEditorToolbar';
import { DocxEditorSidebar } from './DocxEditor/DocxEditorSidebar';
import { BrandLogo } from './ui/BrandLogo';
import { HorizontalRuler } from './ui/HorizontalRuler';
import { Z_INDEX } from '../styles/zIndex';
import type { SectionProperties } from '../legacy-core-compat';
import { pixelsToTwips } from '../legacy-core-compat';
import { VerticalRuler } from './ui/VerticalRuler';
import { PageIndicator } from './DocxEditor/PageIndicator';
import type { DocxEditorProps, DocxEditorRef } from '../types';

/**
 * React host for the DOCX editor. It supplies an `EditorHost` (DOM handles,
 * frame scheduling, a display sink), constructs the `Editor` through
 * `createEditor`, and paints the positioned `DisplayPage[]` the engine emits.
 * All editing, querying, and geometry go through the `Editor` facade.
 *
 * Direct editing (interactive-paginated-editing 6.2): real pointer and keyboard
 * events on the painted pages are forwarded to the shared interaction
 * controller by `attachAdapterEventBridge`. The adapter normalizes nothing and
 * measures nothing — it reports scroll and zoom through
 * `measureInteractionHostMetrics`, hands raw client coordinates to the engine,
 * and paints back the caret and selection geometry the engine returns.
 */

/**
 * Legacy chrome geometry, ported verbatim from `DocxEditor.tsx` and
 * `DocxEditorShell.tsx` at 9bb06c38 (task M6V.1).
 *
 * These were inline style objects in the legacy code, not CSS classes, and the values
 * are load-bearing: the scroll container must be the flex child that shrinks
 * (`minHeight/minWidth: 0`) or the page stops scrolling, and `overflowAnchor: none`
 * stops the browser fighting the engine over scroll position during relayout.
 */
/** i18n keys for the header actions. Keys only — the adapter ships no English. */
const APP_ACTION_KEYS = { open: 'toolbar.open', new: 'app.newDocument', save: 'toolbar.save' } as const;

const LEGACY_CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  backgroundColor: 'var(--doc-bg)',
};

const LEGACY_MAIN_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  flexDirection: 'row',
};

const LEGACY_COLUMN_STYLE: CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};

const LEGACY_SCROLLER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  overflowAnchor: 'none',
};

const LEGACY_RULER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  paddingTop: 4,
  paddingBottom: 4,
  paddingLeft: 20,
  paddingRight: 20,
  flexShrink: 0,
  backgroundColor: 'var(--doc-bg)',
  position: 'sticky',
  top: 0,
  zIndex: 30,
};

const LEGACY_CONTENT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  position: 'relative',
};

const LEGACY_CONTENT_STYLE: CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};



/**
 * Section geometry for the legacy rulers, derived from what the engine publishes.
 *
 * The legacy rulers take a `SectionProperties` record because legacy read section data
 * straight from the document model. The greenfield engine publishes the same geometry
 * through `Editor.getPageGeometry()` — page box plus the `contentBox` the layout actually
 * used — so the record is BUILT from that rather than the adapter reaching into a model
 * it does not own. Margins are uniform on all four sides in the engine today; that is
 * what is reported, and nothing here invents a per-side value.
 *
 * Returns `undefined` before layout publishes, so the rulers render their bare scale
 * rather than one positioned against guessed geometry.
 */
function sectionPropsFromGeometry(editor: Editor | null): SectionProperties | undefined {
  const page = editor?.getPageGeometry()[0];
  if (!page) return undefined;
  const left = Math.round(pixelsToTwips(page.contentBox.x - page.box.x));
  const top = Math.round(pixelsToTwips(page.contentBox.y - page.box.y));
  const right = Math.round(
    pixelsToTwips(page.box.width - (page.contentBox.x - page.box.x) - page.contentBox.width),
  );
  const bottom = Math.round(
    pixelsToTwips(page.box.height - (page.contentBox.y - page.box.y) - page.contentBox.height),
  );
  return {
    pageWidth: Math.round(pixelsToTwips(page.box.width)),
    pageHeight: Math.round(pixelsToTwips(page.box.height)),
    margins: { left, right, top, bottom },
  } as SectionProperties;
}

export const DocxEditor = forwardRef<DocxEditorRef, DocxEditorProps>(
  function DocxEditor(props, ref) {
    const { document: doc, className, t, title, onTitleChange, onSave } = props;

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const pagesRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const [pages, setPages] = useState<readonly DisplayPage[]>([]);
    const [overlays, setOverlays] = useState<FrameOverlays>({ caret: null, selection: [] });
    const [clickTarget, setClickTarget] = useState<GlyphClickTarget | null>(null);

    // Latest props/callbacks, read inside effects without retriggering them.
    const propsRef = useRef(props);
    propsRef.current = props;

    // Re-read the published frame and repaint the overlay layer. Runs after
    // every display and selection change so the caret cannot lag the model.
    const syncFromFrame = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const frame = editor.getInteractionFrame();
      setOverlays(overlaysForFrame(frame));
      setClickTarget(firstEditableGlyphTarget(frame));
    }, []);

    const host = useMemo<EditorHost>(
      () => ({
        getBodyHostEl: () => bodyRef.current,
        getHfHostEl: () => null,
        getPagesContainer: () => pagesRef.current,
        getScrollContainer: () => scrollRef.current,
        // Measured from the PAGES stack, not the scroll container. The engine
        // publishes page boxes starting at content (0, 0), so the client origin
        // it needs is the origin of that stack — which already accounts for
        // scroll position and for the stack being centered in a wider viewport.
        // Measuring the scroll container instead shifts every hit test by the
        // centering offset and lands clicks outside page geometry.
        getInteractionHostMetrics: () => {
          const pagesEl = pagesRef.current;
          if (!pagesEl) return null;
          return measureInteractionHostMetrics(pagesEl, propsRef.current.zoom ?? 1);
        },
        scheduleFrame: (cb) => {
          const id = requestAnimationFrame(cb);
          return () => cancelAnimationFrame(id);
        },
        onDisplay: (next) => setPages(next),
      }),
      []
    );

    // Create the editor once. `document`/`zoom`/`locale` seed the initial
    // config; later document changes flow through `load` below, not a
    // teardown, so undo/selection/scroll survive parent re-renders.
    useEffect(() => {
      const p = propsRef.current;
      const editor = createEditor({
        host,
        document: p.document,
        zoom: p.zoom,
        locale: p.locale,
        author: p.author,
        mode: p.mode,
      });
      editorRef.current = editor;
      propsRef.current.onReady?.(editor);
      const offChange = editor.on('change', (c) => {
        propsRef.current.onChange?.(c);
        syncFromFrame();
      });
      const offSelection = editor.on('selectionChange', () => syncFromFrame());
      const offDisplay = editor.on('display', () => syncFromFrame());
      syncFromFrame();
      return () => {
        offChange();
        offSelection();
        offDisplay();
        editor.destroy();
        editorRef.current = null;
      };
    }, [host, syncFromFrame]);

    // Forward real pointer, keyboard, and focus events on the painted pages to
    // the shared controller. The bridge owns normalization for both adapters;
    // its disposer must run on unmount or listeners outlive the editor.
    useEffect(() => {
      const surface = scrollRef.current;
      if (!surface) return undefined;
      const detach = attachAdapterEventBridge(surface, {
        getInteractionFrameId: () => editorRef.current?.getInteractionFrame().id ?? null,
        dispatchInteraction: (intent: InteractionIntent) => {
          const result = editorRef.current!.dispatchInteraction(intent);
          syncFromFrame();
          return result;
        },
      });
      return detach;
    }, [syncFromFrame]);

    // Reload on document-identity change (skip the initial mount, which already
    // loaded it via createEditor).
    const seededDoc = useRef(true);
    useEffect(() => {
      if (seededDoc.current) {
        seededDoc.current = false;
        return;
      }
      if (doc) editorRef.current?.load(doc);
    }, [doc]);

    useImperativeHandle(
      ref,
      () => ({
        load: (document) => editorRef.current!.load(document),
        save: () => editorRef.current!.save(),
        focus: (scope) => editorRef.current!.focus(scope),
        exec: (command, options) => editorRef.current!.exec(command, options),
        snapshot: (options) => editorRef.current!.snapshot(options),
        getDocumentHandle: () => editorRef.current!.getDocumentHandle(),
        getEditor: () => editorRef.current,
      }),
      []
    );

    // Zoom scales the whole page stack from its top-left. The same factor is
    // reported to the engine through host metrics, so client-to-content mapping
    // stays a plain divide and paint and hit testing agree.
    const zoomFactor = props.zoom ?? 1;
    useEffect(() => {
      editorRef.current?.relayout();
    }, [zoomFactor]);

    // The painted surface. Unchanged whether or not chrome is rendered, so the
    // scroll container, host metrics, and every existing selector stay identical.
    const surface = (
      <div
        ref={scrollRef}
        data-testid="docx-editor-scroll"
        // `ep-root` is the library's style scope: every --doc-* token is declared
        // under it. Without it the caret, selection highlight, and page background
        // all resolve to nothing and paint invisibly on a white page.
        className={`ep-root ep-one-surface ep-one-surface__viewport${className ? ` ${className}` : ''}`}
      >
        <div
          ref={pagesRef}
          className="ep-one-surface__pages"
          style={{ transform: `scale(${zoomFactor})`, transformOrigin: 'top left' }}
        >
          {paintDisplay(pages, overlays, clickTarget)}
        </div>
        <div
          ref={bodyRef}
          className="ep-one-surface__input-host"
          style={{ position: 'fixed', width: 0, height: 0, overflow: 'visible', pointerEvents: 'none' }}
        />
      </div>
    );

    // Chrome is composed HERE, in the production component (task M6V.1) — not in a
    // second shell under `examples/`, which is how the demo and the published
    // component drift apart.
    //
    // Opt-in through `t`: the adapter ships no English of its own, so a host that has
    // not supplied a translator gets the bare surface it gets today rather than a
    // toolbar labelled with raw i18n keys. Every existing consumer and every existing
    // selector is therefore unaffected.
    if (!t) return surface;

    return (
      <div
        className={`ep-root docx-editor${className ? ` ${className}` : ''}`}
        style={LEGACY_CONTAINER_STYLE}
        data-testid="docx-editor"
      >
        {/* Application header. The legacy product's top row: product identity on the
            left, document actions on the right. Every action here is parity-only and
            disabled — M6V.1 permits only undo, redo, bold, italic, and save to act, and
            save already has its toolbar control. */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-border bg-background px-3.5 py-1.5">
          <div className="flex items-center gap-2">
            {/* The real lockup — `BrandLogo`, the same component the docx-editor.dev
                header uses (DocxIcon + wordmark + the EigenPal mark). It replaces the
                icon and text the interim implementation had here, including the asterisk that mark
                carries and my version never had. */}
            <BrandLogo />
            {/* Framework segmented toggle. Parity-only: this build IS the React adapter,
                and Vue chrome is task 10V.1. */}
            <span className="inline-flex items-center rounded-lg border border-border bg-muted p-0.5" role="group" aria-label={t('app.framework')}>
              <span className="whitespace-nowrap rounded-md bg-background px-2.5 py-[3px] text-xs text-foreground shadow-sm">React</span>
              <span className="whitespace-nowrap rounded-md px-2.5 py-[3px] text-xs text-muted-foreground">Vue</span>
            </span>
          </div>
          {/* Title and menu sit INSIDE the header row, as a compact column between the
              brand and the actions. Rendering them as their own full-width bands below
              the header is what made the chrome three tall stacked strips instead of the
              legacy product's single ~110px band. */}
          <div className="flex min-w-0 flex-1 flex-col items-start justify-center pl-[18px]">
            <DocxEditorTitleBar title={title ?? ''} onTitleChange={onTitleChange} />
            <DocxEditorMenuBar t={t} />
          </div>
          <div className="flex items-center gap-2">
            {/* Light/dark toggle. Parity-only — the document canvas is deliberately not
                themed (it must stay Word-faithful), so a working toggle here would imply
                a capability the renderer does not have. */}
            <span className="mr-1 inline-flex items-center rounded-lg border border-border bg-muted p-0.5" role="group" aria-label={t('app.theme')}>
              <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-background text-xs text-foreground shadow-sm transition-colors" aria-hidden="true">☀</span>
              <span className="grid h-[26px] w-[26px] place-items-center rounded-full text-xs text-muted-foreground transition-colors" aria-hidden="true">☾</span>
            </span>
            {(['open', 'new', 'save'] as const).map((action) => (
              <button
                key={action}
                type="button"
                className={clsx(
                  'whitespace-nowrap rounded-md border px-3 py-1.5 text-[13px] font-medium transition-all',
                  'cursor-default pointer-events-none',
                  action === 'open'
                    ? 'border-foreground bg-foreground text-background'
                    : action === 'new'
                      ? 'border-border bg-muted text-foreground'
                      : 'border-border bg-background text-foreground',
                )}
                data-testid={`app-action-${action}`}
                data-parity-only="true"
                disabled
                title={`${t(APP_ACTION_KEYS[action])} — ${t('formattingBar.unavailableInPreview')}`}
                aria-label={`${t(APP_ACTION_KEYS[action])} — ${t('formattingBar.unavailableInPreview')}`}
              >
                {t(APP_ACTION_KEYS[action])}
              </button>
            ))}
          </div>
        </div>
        <div style={LEGACY_MAIN_STYLE}>
          <div style={LEGACY_COLUMN_STYLE}>
            <DocxEditorToolbar editor={editorRef.current} t={t} onSave={onSave} />
            <div className="docx-editor__scroll-container" style={LEGACY_SCROLLER_STYLE}>
              {/* Sticky at the scroller's top so it tracks horizontal scroll, as legacy. */}
              <div className="flex justify-center py-1 flex-shrink-0 bg-doc-bg" style={LEGACY_RULER_ROW_STYLE}>
                <HorizontalRuler sectionProps={sectionPropsFromGeometry(editorRef.current)} zoom={zoomFactor} editable={false} />
              </div>
              <div style={LEGACY_CONTENT_ROW_STYLE}>
                <div className="docx-editor__content" style={LEGACY_CONTENT_STYLE}>
                  {/* Anchors itself to the page, so it sits immediately left of the
                      document rather than in the window's left gutter (M6V.1). */}
                  {/* Wrapper COPIED from the legacy shell (DocxEditorShell.tsx:222-233):
                      absolute at the editor content's left edge, `paddingTop: 48` to
                      match the pages container's own padding so the ruler's zero lines up
                      with the first page. Placement is only correct once the legacy shell
                      composes the content area; until then this reproduces legacy's own
                      values rather than a position estimated to look right. */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      zIndex: Z_INDEX.ruler,
                      paddingTop: 48,
                    }}
                  >
                    <VerticalRuler
                      sectionProps={sectionPropsFromGeometry(editorRef.current)}
                      zoom={zoomFactor}
                      editable={false}
                    />
                  </div>
                  {/* Outline toggle, in the left gutter as in the reference. */}
                  <button
                    type="button"
                    className="absolute left-6 top-6 z-10 grid h-9 w-9 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm"
                    data-testid="outline-toggle"
                    data-parity-only="true"
                    disabled
                    title={`${t('toolbar.tableOfContents')} — ${t('formattingBar.unavailableInPreview')}`}
                    aria-label={`${t('toolbar.tableOfContents')} — ${t('formattingBar.unavailableInPreview')}`}
                  >
                    <svg viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true" focusable="false">
                      <path d="M120-240v-80h240v80H120Zm0-200v-80h480v80H120Zm0-200v-80h720v80H120Z" fill="currentColor" />
                    </svg>
                  </button>
                  {surface}
                </div>
              </div>
            </div>
            <PageIndicator
              currentPage={(editorRef.current?.getCurrentPage('viewport') ?? 0) + 1}
              totalPages={editorRef.current?.getTotalPages() ?? 0}
              visible={(editorRef.current?.getTotalPages() ?? 0) > 1}
            />
          </div>
          <DocxEditorSidebar editor={editorRef.current} open={false} t={t} />
        </div>
      </div>
    );
  }
);
