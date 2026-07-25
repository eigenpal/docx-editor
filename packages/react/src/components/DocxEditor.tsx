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
import { paintDisplay } from '../paintDisplay';
// The legacy title + menu components. My DocxEditorTitleBar/DocxEditorMenuBar are
// deleted: two versions of one control is the drift the port rule warns about.
import { DocumentName, Logo, MenuBar, TitleBar, TitleBarRight } from './TitleBar';
import { Toolbar } from './Toolbar';
import { EditorToolbarContext } from './EditorToolbarContext';
import { OutlineToggleButton } from './DocxEditor/OutlineToggleButton';
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
    const { document: doc, className, t, title, onTitleChange, onSave, renderTitleBarLeft, renderTitleBarRight } = props;

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const pagesRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const [pages, setPages] = useState<readonly DisplayPage[]>([]);
    const [overlays, setOverlays] = useState<FrameOverlays>({ caret: null, selection: [] });
    const [clickTarget, setClickTarget] = useState<GlyphClickTarget | null>(null);
    // Bumped on scroll so the page chip re-reads `getCurrentPage('viewport')`. The engine
    // answers live; without this the chip painted once and froze at page 1.
    const [scrollTick, setScrollTick] = useState(0);

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
      const el = scrollRef.current;
      if (!el) return undefined;
      const onScroll = () => setScrollTick((n) => n + 1);
      el.addEventListener('scroll', onScroll, { passive: true });
      return () => el.removeEventListener('scroll', onScroll);
    }, []);

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
      <EditorToolbarContext.Provider
        value={{
          onUndo: () => void editorRef.current?.exec({ type: 'undo' }),
          onRedo: () => void editorRef.current?.exec({ type: 'redo' }),
          onSave,
        }}
      >
      <div
        className={`ep-root docx-editor${className ? ` ${className}` : ''}`}
        style={LEGACY_CONTAINER_STYLE}
        data-testid="docx-editor"
      >
        {/* Title bar. The DEMO owns what sits left and right — brand lockup, adapter
            and example switchers, theme toggle, Open/New/Save — and passes them through
            these slots, exactly as the legacy demo does (App.tsx:835-865). The editor
            supplies only the document name and menu bar, which are its own.

            The interim brand block, React/Vue toggle, theme toggle and action buttons
            are deleted. `AdapterSwitcher` and `ExampleSwitcher` already existed in
            `examples/shared`; rebuilding them here is what kept the header drifting. */}
        {/* Title bar AND toolbar share one white container, as legacy's EditorToolbar
            does (`flex flex-col bg-doc-surface shadow-sm flex-shrink-0`). That is why the
            reference shows white continuing below the toolbar with the grey workspace
            starting under it; mine ended the white at the title bar. */}
        <div className="flex flex-col bg-doc-surface shadow-sm flex-shrink-0">
        {/* The legacy TitleBar compound component, not my hand-rolled row. It owns the
            layout — `flex items-stretch bg-doc-surface pt-2 pb-1`, logo `pl-3 pr-1`,
            middle column `flex-1 min-w-0 py-1`, right `px-3` — which is where the gaps
            and paddings the owner flagged actually come from. Mine were authored
            (`gap-3 px-3.5 py-1.5`, `pl-[18px]`). */}
        <TitleBar>
          <Logo>{renderTitleBarLeft?.()}</Logo>
          <DocumentName value={title ?? ''} onChange={(next) => onTitleChange?.(next)} />
          <MenuBar />
          <TitleBarRight>{renderTitleBarRight?.()}</TitleBarRight>
        </TitleBar>
            <Toolbar />
        </div>
        <div style={LEGACY_MAIN_STYLE}>
          <div style={LEGACY_COLUMN_STYLE}>
            {/* The LEGACY toolbar (components/Toolbar.tsx), not my descriptor-driven
                one. `LEGACY_CHROME_GROUPS` was an interim control list — wrong set,
                wrong order, four alignment buttons where legacy has one split control,
                plus image/table/download controls the product does not show. Legacy's own
                composition is the source of truth. Every prop is optional, so it renders
                its full control set now and each handler wires to the engine as the
                matching capability lands. */}
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
                  {/* The LEGACY OutlineToggleButton, not my inline button. It carries
                      `.docx-outline-toggle`, whose disc/ring/hover live in the shared
                      stylesheet; my Tailwind version overrode all of it, and the label
                      appended a preview disclaimer that legacy never had. */}
                  <OutlineToggleButton onClick={() => {}} topPx={24} scrollLeft={0} leftOffset={24} />
                  {surface}
                </div>
              </div>
            </div>
            <PageIndicator
              key={scrollTick}
              currentPage={(editorRef.current?.getCurrentPage('viewport') ?? 0) + 1}
              totalPages={editorRef.current?.getTotalPages() ?? 0}
              visible={(editorRef.current?.getTotalPages() ?? 0) > 1}
            />
          </div>
          {/* The interim sidebar is deleted. The legacy sidebar comes across with
              the dialogs and comment panels in the remaining port step. */}
        </div>
      </div>
      </EditorToolbarContext.Provider>
    );
  }
);
