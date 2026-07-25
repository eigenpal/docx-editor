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
// The title bar is composed by DocxEditorToolbar (via EditorToolbar's compound parts),
// which is where legacy assembles it — this file no longer composes it separately.
import { DocxEditorToolbar } from './DocxEditor/DocxEditorToolbar';
import { prefersColorSchemeDark, resolveIsDark, subscribeSystemDark } from '../lib/colorMode';
import type { EditorMode } from './DocxEditor/internals/editing-modes';
import { useOutlineSidebar } from './DocxEditor/hooks/useOutlineSidebar';
import { useScrollPageInfo } from './DocxEditor/hooks/useScrollPageInfo';
import { EditorToolbarContext } from './EditorToolbarContext';
import { DocxEditorShell } from './DocxEditor/DocxEditorShell';
import type { SectionProperties } from '../legacy-core-compat';
import { pixelsToTwips } from '../legacy-core-compat';
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

const LEGACY_MAIN_CONTENT_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0, // Allow flex item to shrink below content size
  minWidth: 0, // Allow flex item to shrink below content width on narrow viewports
  flexDirection: 'row',
};

const LEGACY_EDITOR_CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0, // Allow flex item to shrink below content width on narrow viewports
  overflow: 'auto', // Sole scroll container — the page stack sizes to content
  position: 'relative',
  overflowAnchor: 'none',
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
    const { document: doc, className, t, title, onTitleChange, onSave, renderTitleBarLeft, renderTitleBarRight, colorMode = 'light' } = props;

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

    const {
      showOutline,
      setShowOutline,
      outlineHeadings,
      setHeadingInfos,
      toolbarHeight,
      toolbarRefCallback,
      editorScrollLeft,
    } = useOutlineSidebar({
      showOutlineProp: false,
      editorRef,
      scrollContainerRef: scrollRef,
      isLoading: pages.length === 0,
    });

    // Colour mode, resolved as legacy resolves it: 'system' subscribes to the OS setting
    // and re-syncs immediately, correcting a stale seed if it changed while the mode was
    // pinned. Only `.dark` on the chrome root moves; the canvas is untouched.
    const [systemDark, setSystemDark] = useState(prefersColorSchemeDark);
    useEffect(() => {
      if (colorMode !== 'system') return;
      return subscribeSystemDark(setSystemDark);
    }, [colorMode]);
    const isDark = resolveIsDark(colorMode, systemDark);

    // Chrome state the ported toolbar owns the controls for. The comments sidebar has
    // nothing to show while `getComments` is a stub, but the toggle is wired rather than
    // absent — a missing control reads as "unsupported forever".
    const [editingMode, setEditingMode] = useState<EditorMode>('editing');
    const [showCommentsSidebar, setShowCommentsSidebar] = useState(false);
    const [expandedSidebarItem, setExpandedSidebarItem] = useState<string | null>(null);

    // `selectionFormatting` is how the legacy toolbar drives its active states and value
    // displays — `active={currentFormatting.bold}` and the pickers' current font/size/
    // style. Supplying it from the engine's derivation is the wiring that makes B/I
    // highlight and the pickers show the caret's actual formatting.
    const f = editorRef.current?.getSelectionFormatting();
    const selectionFormatting = {
      ...(f?.bold !== undefined ? { bold: f.bold } : {}),
      ...(f?.italic !== undefined ? { italic: f.italic } : {}),
      ...(f?.underline !== undefined ? { underline: f.underline } : {}),
      ...(f?.fontFamily ? { fontFamily: f.fontFamily } : {}),
      ...(f?.fontSizeHalfPoints ? { fontSize: f.fontSizeHalfPoints } : {}),
      ...(f?.styleId ? { styleId: f.styleId } : {}),
    };

    // Collect headings on open, as legacy did — it walked the editing engine's
    // document tree; here the engine derives the outline from the authored model.
    const handleToggleOutline = useCallback(() => {
      setShowOutline((prev) => {
        if (!prev) {
          const headings = editorRef.current?.getOutline() ?? [];
          setHeadingInfos(headings.map((h, i) => ({ text: h.text, level: h.level, pmPos: i })));
        }
        return !prev;
      });
    }, [setShowOutline, setHeadingInfos]);

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

    // The floating page pill: current page, total, and the fade-out after scrolling
    // stops — all from the legacy hook, reading the engine instead of a layout object.
    const { scrollPageInfo } = useScrollPageInfo({
      scrollContainerRef: scrollRef,
      pagesContainerRef: pagesRef,
      editorRef,
      zoom: zoomFactor,
    });

    // The painted surface.
    //
    // WHICH ELEMENT SCROLLS depends on whether chrome is rendered. Bare, this viewport
    // is the scroll container, as it has always been. Inside the shell, the shell's
    // `.docx-editor__scroll-container` is the sole scroller — that is legacy's structure,
    // and it is what the page indicator, the outline panel's horizontal tracking and the
    // sticky ruler are all written against. Two nested `overflow: auto` boxes meant
    // neither was bounded: every ancestor grew to the full document height and the WINDOW
    // scrolled, which is why the indicator never left page 1.
    const chromeOn = Boolean(t);
    const surface = (
      <div
        ref={chromeOn ? null : scrollRef}
        data-testid="docx-editor-scroll"
        // `ep-root` is the library's style scope: every --doc-* token is declared
        // under it. Without it the caret, selection highlight, and page background
        // all resolve to nothing and paint invisibly on a white page.
        className={`ep-root ep-one-surface ep-one-surface__viewport${chromeOn ? ' ep-one-surface__viewport--hosted' : ''}${className ? ` ${className}` : ''}`}
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
        {/* The legacy DocxEditorShell, which was ported and sitting unused while this
            file duplicated its layout — a rule-3 violation an independent audit caught.
            It owns the scroll container, ruler placement, outline button position and
            page-indicator anchoring, all of which had been reimplemented with authored
            values. Slots take what this component already had.

            Ruler callbacks are no-ops: this change owns no section-geometry contract, so
            the rulers stay display-only (M4.4). Indents and tab marks are absent from the
            engine, so they report zero/none rather than a guess. */}
        <DocxEditorShell
          i18n={undefined as never}
          onEditorError={() => {}}
          containerRef={null}
          scrollContainerRef={scrollRef}
          editorContentRef={null}
          className={className}
          isDark={isDark}
          containerStyle={LEGACY_CONTAINER_STYLE}
          mainContentStyle={LEGACY_MAIN_CONTENT_STYLE}
          editorContainerStyle={LEGACY_EDITOR_CONTAINER_STYLE}
          showRuler
          readOnlyProp={false}
          showOutline={showOutline}
          showOutlineButton
          sidebarOpen={showCommentsSidebar}
          minLayoutWidth={0}
          toolbarHeight={toolbarHeight}
          editorScrollLeft={editorScrollLeft}
          expandedSidebarItem={expandedSidebarItem}
          trackedChanges={[]}
          onScrollContainerMouseDown={() => {}}
          onEditorBgMouseDown={() => {}}
          onEditorContextMenu={() => {}}
          horizontalRulerProps={{
            sectionProps: sectionPropsFromGeometry(editorRef.current),
            zoom: zoomFactor,
            unit: 'inch',
            editable: false,
            onLeftMarginChange: () => {},
            onRightMarginChange: () => {},
            indentLeft: 0,
            indentRight: 0,
            onIndentLeftChange: () => {},
            onIndentRightChange: () => {},
            firstLineIndent: 0,
            hangingIndent: false,
            onFirstLineIndentChange: () => {},
            tabMarks: null,
            onTabMarkRemove: () => {},
          }}
          verticalRulerProps={{
            sectionProps: sectionPropsFromGeometry(editorRef.current),
            zoom: zoomFactor,
            unit: 'inch',
            editable: false,
            onTopMarginChange: () => {},
            onBottomMarginChange: () => {},
          }}
          outlineProps={{
            headings: outlineHeadings,
            onHeadingClick: () => {},
            onClose: () => setShowOutline(false),
            topOffset: toolbarHeight,
            scrollLeft: editorScrollLeft,
          }}
          onToggleOutline={handleToggleOutline}
          scrollPageInfo={scrollPageInfo}
          agentPanel={undefined}
          agentPanelOpen={false}
          onAgentPanelClose={() => {}}
          toolbar={
            /* The legacy DocxEditorToolbar, not the composition had been inlined here. It
               owns the measuring wrapper, the title-bar row, the comments/mode/agent
               controls and the toolbar band — all of which had been partly rebuilt.

               Engine-backed props: `document` is the legacy-shaped projection the ported
               toolbar reads styles off (it takes `document?.package.styles?.styles`), and
               `editor` answers canUndo/canRedo. Everything the engine cannot answer yet
               is passed as the honest empty value, not a guess: no table or image
               context, no theme, no watermark or page-setup dialogs. */
            <DocxEditorToolbar
              toolbarRefCallback={toolbarRefCallback}
              agentPanelOpen={false}
              setAgentPanelOpen={() => {}}
              document={{
                package: {
                  styles: {
                    styles: (editorRef.current?.getDocumentStyles() ?? []).map((st) => ({
                      styleId: st.styleId,
                      name: st.name,
                      type: 'paragraph' as const,
                    })),
                  },
                },
              }}
              theme={null}
              editor={editorRef.current}
              selectionFormatting={selectionFormatting}
              tableContext={null}
              imageContext={null}
              readOnly={false}
              editingMode={editingMode}
              setEditingMode={setEditingMode}
              setShowCommentsSidebar={setShowCommentsSidebar}
              setExpandedSidebarItem={setExpandedSidebarItem}
              showCommentsSidebar={showCommentsSidebar}
              agentPanel={undefined}
              renderLogo={renderTitleBarLeft}
              documentName={title ?? ''}
              onDocumentNameChange={onTitleChange}
              documentNameEditable={true}
              renderTitleBarRight={renderTitleBarRight}
              toolbarExtra={null}
              fontFamilies={undefined}
              documentFonts={(editorRef.current?.getDocumentFonts() ?? []).map((name) => ({
                name,
                fontFamily: name,
              }))}
              zoom={zoomFactor}
              showZoomControl
              onFormat={() => {}}
              onUndo={() => void editorRef.current?.exec({ type: 'undo' })}
              onRedo={() => void editorRef.current?.exec({ type: 'redo' })}
              onPrint={() => {}}
              showFileOpen={false}
              showHelpMenu
              onOpen={() => {}}
              onSave={() => onSave?.()}
              onZoomChange={() => {}}
              onRefocusEditor={() => editorRef.current?.focus()}
              onInsertTable={() => {}}
              onInsertImage={() => {}}
              onInsertPageBreak={() => {}}
              onInsertSectionBreakNextPage={() => {}}
              onInsertSectionBreakContinuous={() => {}}
              onInsertTOC={() => {}}
              onImageWrapType={() => {}}
              onImageTransform={() => {}}
              onOpenImageProperties={() => {}}
              onPageSetup={() => {}}
              onWatermark={() => {}}
              onTableAction={() => {}}
            />
          }
          pagedArea={surface}
          overlays={null}
          dialogs={null}
          fileInputs={null}
        />
      </EditorToolbarContext.Provider>
    );
  }
);
