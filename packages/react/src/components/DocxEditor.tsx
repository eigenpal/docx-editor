import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Editor, EditorHost, TextMatch } from '@docx-editor.dev/core-contract/editor';
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
// The title bar is composed by DocxEditorToolbar (via EditorToolbar's compound parts),
// which is where legacy assembles it — this file no longer composes it separately.
import { DocxEditorPagedArea } from './DocxEditor/DocxEditorPagedArea';
import { DocxEditorToolbar } from './DocxEditor/DocxEditorToolbar';
import { DocxEditorOverlays } from './DocxEditor/DocxEditorOverlays';
import { useContextMenus } from './DocxEditor/hooks/useContextMenus';
import { useFormattingActions } from './DocxEditor/hooks/useFormattingActions';
import { useFileIO } from './DocxEditor/hooks/useFileIO';
import { useTableDialogs, type BorderSpec } from './DocxEditor/hooks/useTableDialogs';
import { useHyperlinkActions } from './DocxEditor/hooks/useHyperlinkActions';
import { useWatermarkControls } from './DocxEditor/hooks/useWatermarkControls';
import { usePageSetupControls } from './DocxEditor/hooks/usePageSetupControls';
import { useActiveEditor } from './DocxEditor/hooks/useActiveEditor';
import { useTableOfContentsActions } from './DocxEditor/hooks/useTableOfContentsActions';
import { useFloatingCommentBtn } from './DocxEditor/hooks/useFloatingCommentBtn';
import { useDocumentLoader } from './DocxEditor/hooks/useDocumentLoader';
import { useCommentManagement } from './DocxEditor/hooks/useCommentManagement';
import { MaterialSymbol } from './ui/Icons';
import {
  useSelectionTracker,
  type SelectionStateDelta,
} from './DocxEditor/hooks/useSelectionTracker';
import { useKeyboardShortcuts } from './DocxEditor/hooks/useKeyboardShortcuts';
import { useFindReplace } from '../hooks/useFindReplace';
import { DocxEditorDialogs } from './DocxEditor/DocxEditorDialogs';
import type { FindMatch, FindOptions, FindResult } from './dialogs/findReplaceUtils';
import { useHyperlinkDialog } from './dialogs/HyperlinkDialog';
import { OUTLINE_RESERVED_SPACE, OUTLINE_BUTTON_RESERVED_SPACE } from './DocumentOutline';
import { SIDEBAR_DOCUMENT_SHIFT } from './sidebar/constants';
import { RULER_WIDTH } from './ui/VerticalRuler';
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
  // FLAT margin fields, which is what `SectionProperties` declares and what the rulers
  // read. This used to build a nested `margins` object behind an `as` cast — the cast
  // compiled, the rulers got `marginLeft: undefined`, and their margin zones never
  // rendered against real geometry.
  return {
    pageWidth: Math.round(pixelsToTwips(page.box.width)),
    pageHeight: Math.round(pixelsToTwips(page.box.height)),
    marginLeft: left,
    marginRight: right,
    marginTop: top,
    marginBottom: bottom,
  };
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

    // Find/replace and hyperlink dialog state, both ported hooks, driven by the ported
    // keyboard shortcuts below (Cmd+F / Cmd+H / Cmd+K, plus Cmd+O and table delete).
    const findReplace = useFindReplace();
    const hyperlinkDialog = useHyperlinkDialog();
    useKeyboardShortcuts({
      editorRef,
      disableFindReplaceShortcuts: false,
      showFileOpen: false,
      findReplace,
      hyperlinkDialog,
    });

    // Find, wired to the engine's derivation.
    //
    // The engine resolves each match to BOTH addresses — its own `blockId` + offset, and
    // the paragraph/run/offset triple this dialog is written against — so the match list
    // is real rather than empty, and nothing here reconstructs run boundaries.
    //
    // Navigation goes through `selectMatch`, which the engine refuses today (it needs
    // offset-addressed selection). The dialog therefore lists and counts matches but does
    // not move the caret, and it learns that from the capability rather than from a
    // handler hard-coded to do nothing.
    const findResultRef = useRef<FindResult | null>(null);
    const engineMatchesRef = useRef<readonly TextMatch[]>([]);

    const toFindMatch = useCallback(
      (m: TextMatch): FindMatch => ({
        paragraphIndex: m.paragraphIndex,
        contentIndex: m.runIndex,
        startOffset: m.runOffset,
        endOffset: m.runOffset + m.length,
        text: m.text,
      }),
      []
    );

    const handleFind = useCallback(
      (searchText: string, options: FindOptions): FindResult | null => {
        const matches =
          editorRef.current?.findMatches(searchText, {
            matchCase: options.matchCase,
            wholeWord: options.matchWholeWord,
          }) ?? [];
        engineMatchesRef.current = matches;
        const result: FindResult = {
          matches: matches.map(toFindMatch),
          totalCount: matches.length,
          currentIndex: matches.length > 0 ? 0 : -1,
        };
        findResultRef.current = result;
        return result;
      },
      [toFindMatch]
    );

    const step = useCallback(
      (delta: 1 | -1): FindMatch | null => {
        const result = findResultRef.current;
        const matches = engineMatchesRef.current;
        if (!result || matches.length === 0) return null;
        const next = (result.currentIndex + delta + matches.length) % matches.length;
        // Only advance if the engine actually moved the selection. Reporting a new
        // current match while the caret stayed put is the lie this guards against.
        if (!editorRef.current?.selectMatch(matches[next]!).ok) return null;
        result.currentIndex = next;
        return toFindMatch(matches[next]!);
      },
      [toFindMatch]
    );

    // The image menu's own state hook, ported.
    // Document lifecycle, ported: load on prop change (skipping the value createEditor
    // already loaded) and publish the font inventory the pickers read. This replaces the
    // inline reload effect and the inline `getDocumentFonts` call this file carried.
    const { documentFonts } = useDocumentLoader({ editorRef, document: doc });

    // Table-of-contents updates, ported — including legacy's deferred second pass, which
    // exists because refreshing a TOC changes page numbers, which repaginates, which
    // changes the numbers the TOC should show.
    const { runTableOfContentsUpdate, handleTableOfContentsInserted } =
      useTableOfContentsActions({ editorRef });

    // Active-editor routing, ported. Every call site below used to repeat
    // `() => editorRef.current?.focus()`; the rule lives in one place again.
    const { focusActiveEditor, undoActiveEditor, redoActiveEditor } = useActiveEditor({
      hfEditPosition: null,
      editorRef,
    });

    // Page setup and the ruler drag handlers, ported. The rulers were wired to no-ops,
    // so dragging a margin did nothing at all; they now reach `setPageSetup`, which the
    // engine refuses, so a drag snaps back instead of silently pretending.
    const {
      showPageSetup,
      setShowPageSetup,
      handleOpenPageSetup,
      handleLeftMarginChange,
      handleRightMarginChange,
      handleTopMarginChange,
      handleBottomMarginChange,
      handlePageSetupApply,
      handleIndentLeftChange,
      handleIndentRightChange,
      handleFirstLineIndentChange,
      handleTabMarkRemove,
    } = usePageSetupControls({ readOnly: false, editorRef });

    // Hyperlink and watermark actions, ported. Both dialogs were opening onto no-op
    // handlers; they now reach the contract's commands.
    const {
      handleHyperlinkSubmit,
      handleHyperlinkRemove,
    } = useHyperlinkActions({
      editorRef,
      focusActiveEditor,
      hyperlinkDialog,
    });
    const {
      showWatermark,
      setShowWatermark,
      handleOpenWatermark,
      currentWatermark,
      handleWatermarkApply,
    } = useWatermarkControls({ readOnly: false, editorRef });

    // Table toolbar actions and their dialogs, ported. The border spec is the shared
    // record legacy threads through the toolbar: a border colour or width picked from a
    // dropdown lands here and the NEXT border action uses it.
    const borderSpecRef = useRef<BorderSpec>({
      style: 'single',
      size: 4,
      color: { kind: 'hex', value: '000000' },
    });
    const {
      tablePropsOpen,
      setTablePropsOpen,
      splitCellDialogState,
      openSplitCellDialog,
      handleTableAction,
      handleSplitCellDialogClose,
      handleSplitCellDialogApply,
    } = useTableDialogs({ editorRef, borderSpecRef });

    // File in and out, ported. Save serializes the canonical package through the engine;
    // open loads bytes into it. The hidden inputs go in the shell's `fileInputs` slot,
    // which this file had left empty.
    const {
      imageInputRef,
      docxInputRef,
      handleDirectPrint,
      handleDownloadDocument,
      handleOpenDocument,
      handleDocxFileChange,
      handleInsertImageClick,
      handleImageFileChange,
    } = useFileIO({
      editorRef,
      documentName: title,
      onDocumentNameChange: onTitleChange,
    });

    // Toolbar actions, ported. Bold and italic apply for real (`toggleMark` is wired in
    // the engine); everything else returns an unsupported result, so the button does
    // nothing rather than something unintended.
    const {
      handleFormat,
      handleInsertTable,
      handleInsertPageBreak,
      handleInsertSectionBreakNextPage,
      handleInsertSectionBreakContinuous,
      handleInsertTOC,
    } = useFormattingActions({
      editorRef,
      focusActiveEditor,
      hyperlinkDialog,
      onTableOfContentsInserted: handleTableOfContentsInserted,
    });

    // The ported context-menu hook. It owns the text menu's state, the item list, the
    // image menu, and the action dispatcher — all of which this file previously passed as
    // empty placeholders.
    const {
      contextMenu,
      imageContextMenu,
      handleEditorContextMenu,
      handleContextMenuClose,
      handleImageWrapApply,
      imageContextMenuTextActions,
      contextMenuItems,
      handleContextMenuAction,
    } = useContextMenus({
      editorRef,
      focusActiveEditor,
      openSplitCellDialog,
      onUpdateTableOfContents: runTableOfContentsUpdate,
      i18n: undefined,
      onAddComment: () => {},
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

    // Toolbar state for the current selection, from the ported tracker. This block used
    // to be an inline derivation in this file; the hook owns it now, and the delta it
    // emits is legacy's shape.
    const [selectionDelta, setSelectionDelta] = useState<SelectionStateDelta>({});
    const { handleSelectionChange } = useSelectionTracker({
      editorRef,
      applySelectionDelta: setSelectionDelta,
    });
    const selectionFormatting = selectionDelta.selectionFormatting ?? {};
    // The editor is constructed once, so its `selectionChange` subscriber closes over the
    // first handler identity. A ref keeps that subscriber calling the CURRENT one.
    const handleSelectionChangeRef = useRef(handleSelectionChange);
    handleSelectionChangeRef.current = handleSelectionChange;
    // Assigned below, once `useFloatingCommentBtn` has run — the editor's subscriber is
    // created once and reads whatever is current at fire time.
    const recomputeFloatingCommentBtnRef = useRef<() => void>(() => {});

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
      const offSelection = editor.on('selectionChange', () => {
        syncFromFrame();
        handleSelectionChangeRef.current();
        recomputeFloatingCommentBtnRef.current();
      });
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
          const editor = editorRef.current!;
          const result = editor.dispatchInteraction(intent);
          // A pointer press makes the editor ACTIVE, not just placed. Without this the
          // caret landed where the reader clicked but focus stayed on `document.body`, so
          // every keystroke — typing, and the toolbar's toggles, which apply at the
          // selection — went nowhere. Legacy did the same thing in its pointer handler
          // (`focusActiveEditor`); the engine exposes it as `focus()`.
          if (intent.kind === 'pointerDown') editor.focus();
          syncFromFrame();
          return result;
        },
      });
      return detach;
    }, [syncFromFrame]);

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

    // Zoom scales the whole page stack from its top-left. The ENGINE owns the factor
    // (`getZoom`/`setZoom`), so the paint transform, the host metrics hit testing divides
    // by, and the toolbar's percentage are one number rather than three that can drift.
    // `props.zoom` seeds it and is honoured on change, so an existing controlled host
    // keeps working; the toolbar drives it through `setZoom` after that.
    // The tick exists to re-render after a zoom change; the engine holds the value, so
    // there is nothing else to store.
    const [, setZoomTick] = useState(0);
    const zoomFactor = editorRef.current?.getZoom() ?? props.zoom ?? 1;
    const applyZoom = useCallback((next: number) => {
      if (editorRef.current?.setZoom(next).ok) setZoomTick((n) => n + 1);
    }, []);
    const propZoom = props.zoom;
    useEffect(() => {
      if (propZoom !== undefined) applyZoom(propZoom);
    }, [propZoom, applyZoom]);

    // Horizontal space the layout must reserve, computed exactly as legacy computes it.
    // Passing 0 (what this file did) meant the centered page never cleared the outline
    // panel or made room for the comments sidebar, so the page sat centred while the
    // reference shifted it left.
    //
    // Legacy read the widest page width off the document's section properties; the engine
    // publishes the laid-out page box, so the widest PAINTED page is what is measured —
    // same quantity, taken from what layout actually produced.
    const outlineLeftAllowance =
      (showOutline ? OUTLINE_RESERVED_SPACE : OUTLINE_BUTTON_RESERVED_SPACE) +
      // The outline toggle/panel inset past the vertical ruler when it's shown,
      // so the page must clear that extra width too.
      RULER_WIDTH;
    const maxPageWidthPx = Math.round(
      Math.max(0, ...(editorRef.current?.getPageGeometry() ?? []).map((p) => p.box.width)),
    );
    // Legacy reserves the sidebar's width when there is something to show in it
    // (`sidebarOpen = allSidebarItems.length > 0`), not when the toggle is on. Same rule
    // here, asked of the engine. Both capabilities are stubs returning [], so the space
    // is not reserved today and the page stays centred — and the moment the engine can
    // answer, the layout shifts with no change here.
    //
    // The CARDS are a separate question: `useCommentSidebarItems` is ported and ready,
    // but the engine's comment shape carries no author, date or paragraph content, so
    // there is nothing to build a card from yet. See the `getComments` stub.
    const sidebarItemCount =
      (editorRef.current?.getComments().length ?? 0) +
      (editorRef.current?.getTrackedChanges().length ?? 0);
    const sidebarOpen = sidebarItemCount > 0;
    const minLayoutWidth =
      2 * outlineLeftAllowance + maxPageWidthPx + (sidebarOpen ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0);

    // Comment state, ported. The controlled/uncontrolled split is legacy's: a host that
    // passes `comments` owns the array, and every mutation goes out through
    // `onCommentsChange` instead of touching internal state.
    const {
      isAddingCommentRef,
      setAddCommentYPosition,
      floatingCommentBtn,
      setFloatingCommentBtn,
    } = useCommentManagement({
      commentsProp: undefined,
      onCommentDelete: undefined,
      onCommentsChange: undefined,
    });

    // The floating "Add comment" button beside a selection, ported. It is positioned
    // from the engine's selection geometry and page box.
    const { recomputeFloatingCommentBtn } = useFloatingCommentBtn({
      editorRef,
      scrollContainerRef: scrollRef,
      pagesContainerRef: pagesRef,
      isAddingCommentRef,
      setFloatingCommentBtn,
      readOnly: false,
      isLoading: pages.length === 0,
      zoom: zoomFactor,
    });
    recomputeFloatingCommentBtnRef.current = recomputeFloatingCommentBtn;

    // The floating page pill: current page, total, and the fade-out after scrolling
    // stops — all from the legacy hook, reading the engine instead of a layout object.
    const { scrollPageInfo } = useScrollPageInfo({
      scrollContainerRef: scrollRef,
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
      <DocxEditorPagedArea
        pages={pages}
        overlays={overlays}
        clickTarget={clickTarget}
        zoom={zoomFactor}
        scrollRef={chromeOn ? null : scrollRef}
        pagesRef={pagesRef}
        bodyRef={bodyRef}
        hosted={chromeOn}
        className={className}
        overlayChildren={
          floatingCommentBtn != null && (
            <button
              type="button"
              title="Add comment"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Legacy marked the range with a pending comment mark here before
                // opening the sidebar. The engine has no comment vocabulary, so this
                // opens the sidebar and records where the card should sit; the mark
                // lands when `getComments` and its command counterpart do.
                setAddCommentYPosition(floatingCommentBtn.top);
                setShowCommentsSidebar(true);
                isAddingCommentRef.current = true;
                setFloatingCommentBtn(null);
              }}
              style={{
                position: 'absolute',
                top: floatingCommentBtn.top,
                left: floatingCommentBtn.left,
                transform: 'translate(-50%, -50%)',
                zIndex: 50,
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--doc-focus-ring)',
                backgroundColor: 'var(--doc-surface)',
                color: 'var(--doc-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 3px var(--doc-shadow)',
                transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <MaterialSymbol name="add_comment" size={16} />
            </button>
          )
        }
      />
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
          onUndo: undoActiveEditor,
          onRedo: redoActiveEditor,
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
          sidebarOpen={sidebarOpen}
          minLayoutWidth={minLayoutWidth}
          toolbarHeight={toolbarHeight}
          editorScrollLeft={editorScrollLeft}
          expandedSidebarItem={expandedSidebarItem}
          trackedChanges={[]}
          onScrollContainerMouseDown={() => {}}
          onEditorBgMouseDown={() => {}}
          onEditorContextMenu={handleEditorContextMenu}
          horizontalRulerProps={{
            sectionProps: sectionPropsFromGeometry(editorRef.current),
            zoom: zoomFactor,
            unit: 'inch',
            editable: true,
            onLeftMarginChange: handleLeftMarginChange,
            onRightMarginChange: handleRightMarginChange,
            // Paragraph indents and tab stops have no capability behind them yet, so the
            // ruler shows none rather than a guessed zero-indent it would then draw.
            indentLeft: 0,
            indentRight: 0,
            onIndentLeftChange: handleIndentLeftChange,
            onIndentRightChange: handleIndentRightChange,
            firstLineIndent: 0,
            hangingIndent: false,
            onFirstLineIndentChange: handleFirstLineIndentChange,
            tabMarks: null,
            onTabMarkRemove: handleTabMarkRemove,
          }}
          verticalRulerProps={{
            sectionProps: sectionPropsFromGeometry(editorRef.current),
            zoom: zoomFactor,
            unit: 'inch',
            editable: true,
            onTopMarginChange: handleTopMarginChange,
            onBottomMarginChange: handleBottomMarginChange,
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
              documentFonts={documentFonts}
              zoom={zoomFactor}
              showZoomControl
              onFormat={handleFormat}
              onUndo={undoActiveEditor}
              onRedo={redoActiveEditor}
              onPrint={handleDirectPrint}
              showFileOpen
              showHelpMenu
              onOpen={handleOpenDocument}
              onSave={() => (onSave ? onSave() : handleDownloadDocument())}
              onZoomChange={applyZoom}
              onRefocusEditor={focusActiveEditor}
              onInsertTable={handleInsertTable}
              onInsertImage={handleInsertImageClick}
              onInsertPageBreak={handleInsertPageBreak}
              onInsertSectionBreakNextPage={handleInsertSectionBreakNextPage}
              onInsertSectionBreakContinuous={handleInsertSectionBreakContinuous}
              onInsertTOC={handleInsertTOC}
              onImageWrapType={() => {}}
              onImageTransform={() => {}}
              onOpenImageProperties={() => {}}
              onPageSetup={handleOpenPageSetup}
              onWatermark={handleOpenWatermark}
              onTableAction={handleTableAction}
            />
          }
          pagedArea={surface}
          overlays={
            /* The ported overlay block, driven by the ported `useContextMenus`. Clipboard
               and selection-addressed edits run through the contract; table entries appear
               only when the engine says the caret is in a table, which is a stub today, so
               they stay out of the menu rather than appearing and doing nothing. */
            <DocxEditorOverlays
              contextMenu={contextMenu}
              contextMenuItems={contextMenuItems}
              onContextMenuAction={handleContextMenuAction}
              onContextMenuClose={handleContextMenuClose}
              imageContextMenu={imageContextMenu}
              onImageWrapApply={handleImageWrapApply}
              imageContextMenuTextActions={imageContextMenuTextActions}
              onOpenImageProperties={() => {}}
              readOnly={false}
            />
          }
          dialogs={
            /* The ported dialog block. Find/replace runs against the engine's
               `findMatches`; the rest open and close but apply nothing, because the
               commands behind them are refused by the engine today — each of those
               handlers is a named capability on the contract, not a missing dialog. */
            <DocxEditorDialogs
              findReplace={findReplace}
              findResultRef={findResultRef}
              onFind={handleFind}
              onFindNext={() => step(1)}
              onFindPrevious={() => step(-1)}
              onReplace={() => false}
              onReplaceAll={() => 0}
              hyperlinkDialog={hyperlinkDialog}
              onHyperlinkSubmit={handleHyperlinkSubmit}
              onHyperlinkRemove={handleHyperlinkRemove}
              tablePropsOpen={tablePropsOpen}
              onTablePropsClose={() => setTablePropsOpen(false)}
              editor={editorRef.current}
              splitCellDialogState={splitCellDialogState}
              onSplitCellDialogClose={handleSplitCellDialogClose}
              onSplitCellDialogApply={handleSplitCellDialogApply}
              imagePositionOpen={false}
              onImagePositionClose={() => {}}
              onApplyImagePosition={() => {}}
              imagePropsOpen={false}
              onImagePropsClose={() => {}}
              onApplyImageProperties={() => {}}
              pmImageContext={null}
              showPageSetup={showPageSetup}
              onPageSetupClose={() => setShowPageSetup(false)}
              onPageSetupApply={handlePageSetupApply}
              showWatermark={showWatermark}
              onWatermarkClose={() => setShowWatermark(false)}
              onWatermarkApply={handleWatermarkApply}
              currentWatermark={currentWatermark}
              document={null}
              footnotePropsOpen={false}
              onFootnotePropsClose={() => {}}
              onApplyFootnoteProperties={() => {}}
            />
          }
          fileInputs={
            /* Hidden pickers behind File ▸ Open and Insert ▸ Image, as legacy has them. */
            <>
              <input
                ref={docxInputRef}
                type="file"
                accept=".docx"
                style={{ display: 'none' }}
                onChange={handleDocxFileChange}
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageFileChange}
              />
            </>
          }
        />
      </EditorToolbarContext.Provider>
    );
  }
);
