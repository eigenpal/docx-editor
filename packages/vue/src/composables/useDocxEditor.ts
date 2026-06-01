/**
 * useDocxEditor — Vue composable for the DOCX editor lifecycle.
 *
 * Manages: DOCX parsing → ProseMirror state → layout pipeline → DOM painting.
 * This is the Vue equivalent of PagedEditor + OffscreenEditorHost from the React package.
 */

import {
  ref,
  onBeforeUnmount,
  shallowRef,
  unref,
  watch,
  type MaybeRef,
  type Ref,
  type ShallowRef,
} from 'vue';
import { EditorState, type Transaction, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

// Core imports — these all resolve through Vite aliases to packages/core/src/
import { parseDocx } from '@eigenpal/docx-editor-core/docx/parser';
import {
  toProseDoc,
  createEmptyDoc,
  headerFooterToProseDoc,
  proseDocToBlocks,
} from '@eigenpal/docx-editor-core/prosemirror/conversion';
import { fromProseDoc } from '@eigenpal/docx-editor-core/prosemirror/conversion/fromProseDoc';
import { schema } from '@eigenpal/docx-editor-core/prosemirror';
import { singletonManager } from '@eigenpal/docx-editor-core/prosemirror/schema';
import {
  createSuggestionModePlugin,
  setSuggestionMode,
  createDocumentStylesPlugin,
} from '@eigenpal/docx-editor-core/prosemirror/plugins';
import {
  ExtensionManager,
  createStarterKit,
} from '@eigenpal/docx-editor-core/prosemirror/extensions';
import type { CommandMap } from '@eigenpal/docx-editor-core/prosemirror/extensions/types';
import { buildBoxTree } from '@eigenpal/docx-editor-core/layout-bridge/buildBoxTree';
import {
  measureBlocksWithFloats,
  paragraphLayout,
} from '@eigenpal/docx-editor-core/layout-bridge/measuring';
import type { FloatingImageZone } from '@eigenpal/docx-editor-core/layout-bridge/measuring';
import {
  measureTable,
  convertHeaderFooterToContent,
  convertHeaderFooterPmDocToContent,
  getPageSize,
  getMargins,
  resolveHeaderFooter,
  collectFootnoteRefs,
  buildFootnoteContentMap,
  buildFootnoteRenderItems,
  stabilizeFootnoteLayout,
} from '@eigenpal/docx-editor-core/layout-bridge';
import {
  layOutPages,
  DEFAULT_TEXTBOX_MARGINS,
  DEFAULT_TEXTBOX_WIDTH,
  assertExhaustiveFlowBlock,
} from '@eigenpal/docx-editor-core/layout-engine';
import { paintPages } from '@eigenpal/docx-editor-core/layout-painter/paintPage';
import type {
  FlowBlock,
  FootnoteContent,
  Layout,
  Measure,
  ParagraphBlock,
  SectionMarkerBlock,
  TableBlock,
  ImageBlock,
  PageMargins,
  TextBoxBlock,
} from '@eigenpal/docx-editor-core/layout-engine/types';
import type { BlockLookup, HeaderFooterContent } from '@eigenpal/docx-editor-core/layout-painter';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import type { SelectionBridge } from '@eigenpal/docx-editor-core/prosemirror';

// ProseMirror CSS — must be imported for the hidden editor to work
import 'prosemirror-view/style/prosemirror.css';
import '@eigenpal/docx-editor-core/prosemirror/editor.css';
// Adapter-level editor styles (cursor, selection, comment highlights,
// table cell layout, page chrome, hover states). Mirror of React's
// packages/react/src/styles/editor.css minus the @tailwind utilities
// directive. See the file's top banner.
import '../styles/editor.css';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PAGE_GAP = 24;

// ============================================================================
// HELPERS
// ============================================================================

// `getPageSize`, `getMargins`, `resolveHeaderFooter` live in
// `@eigenpal/docx-editor-core/layout-bridge` so React and Vue agree on
// twips→px math + HF lookup. Imported at the top of this file.

/**
 * Block measurement for the Vue harness. Two-pass HF measurement is still
 * React-only; footnotes are supported via the two-pass layout in
 * `runLayoutPipeline`. Floating-zone orchestration is shared with React
 * via `measureBlocksWithFloats` in core so anchored images, floating
 * textboxes, and floating tables wrap text consistently across adapters.
 *
 * `measureTable` lives in `@eigenpal/docx-editor-core/layout-bridge`
 * so React and Vue stay in lockstep on table-cell measurement.
 */
function measureBlock(
  block: FlowBlock,
  contentWidth: number,
  floatingZones?: FloatingImageZone[],
  cumulativeY?: number
): Measure {
  switch (block.kind) {
    case 'paragraph':
      return paragraphLayout(block as ParagraphBlock, contentWidth, {
        floatingZones,
        paragraphYOffset: cumulativeY ?? 0,
      });

    case 'table':
      return measureTable(block as TableBlock, contentWidth, measureBlock);

    case 'image': {
      const ib = block as ImageBlock;
      return { kind: 'image', width: ib.width ?? 100, height: ib.height ?? 100 };
    }

    case 'textBox': {
      const tb = block as TextBoxBlock;
      const margins = tb.margins ?? DEFAULT_TEXTBOX_MARGINS;
      const innerWidth = (tb.width ?? DEFAULT_TEXTBOX_WIDTH) - margins.left - margins.right;
      const innerMeasures = tb.content.map((p) => paragraphLayout(p, innerWidth));
      const contentHeight = innerMeasures.reduce((sum, m) => sum + m.totalHeight, 0);
      const totalHeight = tb.height ?? contentHeight + margins.top + margins.bottom;
      return {
        kind: 'textBox' as const,
        width: tb.width ?? DEFAULT_TEXTBOX_WIDTH,
        height: totalHeight,
        innerMeasures,
      };
    }

    case 'pageBreak':
      return { kind: 'pageBreak' };

    case 'columnBreak':
      return { kind: 'columnBreak' };

    case 'sectionBreak':
      return { kind: 'sectionBreak' };

    default:
      // Exhaustiveness guard — see FlowBlock in core/layout-engine/types.ts.
      assertExhaustiveFlowBlock(block, 'vue useDocxEditor measureBlock');
  }
}

function measureBlocks(blocks: FlowBlock[], contentWidth: number): Measure[] {
  return measureBlocksWithFloats(blocks, contentWidth, measureBlock);
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export interface UseDocxEditorOptions {
  /** Container element for the hidden ProseMirror editor */
  hiddenContainer: Ref<HTMLElement | null>;
  /** Container element for the visible pages */
  pagesContainer: Ref<HTMLElement | null>;
  /** Whether the editor is read-only */
  readOnly?: MaybeRef<boolean>;
  /** Page gap in pixels */
  pageGap?: number;
  /** Callback on document change */
  onChange?: (doc: Document) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Callback on selection change */
  onSelectionUpdate?: () => void;
  /** External ProseMirror plugins supplied by the host app. */
  externalPlugins?: Plugin[];
  /** Coordinates layout updates with visible selection/decoration overlays. */
  syncCoordinator?: SelectionBridge;
  /**
   * Editor mode. When set to `'suggesting'`, the composable toggles the
   * mounted suggestion-mode plugin's active state so typed text becomes
   * tracked changes. Reactive — flip at runtime to switch modes.
   * Mirrors React's `editingMode` prop wiring.
   */
  editorMode?: MaybeRef<'editing' | 'suggesting' | 'viewing'>;
  /** Author name attached to tracked changes minted in suggesting mode. */
  author?: MaybeRef<string>;
}

export interface UseDocxEditorReturn {
  /** ProseMirror editor view (hidden). */
  editorView: ShallowRef<EditorView | null>;
  /** Latest editor state. Updated on each transaction. */
  editorState: ShallowRef<EditorState | null>;
  /** True once the editor view has mounted and a document is loaded. */
  isReady: Ref<boolean>;
  /** Last parse error message, or null if the most recent load succeeded. */
  parseError: Ref<string | null>;
  /** Computed page layout. */
  layout: ShallowRef<Layout | null>;
  /** Load a DOCX from a binary buffer. */
  loadBuffer: (buffer: ArrayBuffer | Uint8Array | Blob | File) => Promise<void>;
  /** Load a parsed `Document` directly. */
  loadDocument: (doc: Document) => void;
  /** Serialize the current document to a DOCX blob. */
  save: () => Promise<Blob | null>;
  /** Focus the hidden ProseMirror view. */
  focus: () => void;
  /** Destroy the editor view and clean up listeners. */
  destroy: () => void;
  /** Snapshot the current document model. */
  getDocument: () => Document | null;
  /** Access the extension command map for invoking marks/nodes/features. */
  getCommands: () => CommandMap;
  /** Force a re-layout without a doc change (e.g. after page-setup changes). */
  reLayout: () => void;
  /**
   * Look up the persistent hidden HF EditorView for a HeaderFooter
   * instance. The inline overlay and the click router use this to
   * dispatch selection / focus on the same EditorView the painter reads.
   * Returns null if the document is unloaded or no PM is mounted for
   * the HF's `rId` (cold boot, or just-removed slot).
   */
  getHfPmView: (
    hf: import('@eigenpal/docx-editor-core/types/document').HeaderFooter
  ) => EditorView | null;
  /**
   * Re-mount / tear down HF EditorViews to match the current document's
   * `package.headers/footers`. Call this after the inline overlay saves
   * back into `Document.package.headers` (the swap produces new HeaderFooter
   * objects; new EditorViews need to point at the new objects).
   */
  syncHfPMs: () => void;
  /**
   * Subscribe to every HF transaction. `cb(rId, view)` fires after the
   * EditorView's state has been updated. Used by the painted-HF caret
   * overlay and HF UI chrome (toolbar selection sync).
   */
  setHfTransactionListener: (
    cb: ((rId: string, view: EditorView, docChanged: boolean) => void) | null
  ) => void;
  /** Publish a fresh Document object (used by HF materialisation). */
  setDocument: (doc: Document) => void;
}

export function useDocxEditor(options: UseDocxEditorOptions): UseDocxEditorReturn {
  const {
    hiddenContainer,
    pagesContainer,
    readOnly = false,
    pageGap = DEFAULT_PAGE_GAP,
    onChange,
    onError,
    onSelectionUpdate,
    externalPlugins = [],
    syncCoordinator,
    editorMode,
    author,
  } = options;

  // State
  const document = shallowRef<Document | null>(null);
  const editorView = shallowRef<EditorView | null>(null);
  const editorState = shallowRef<EditorState | null>(null);
  const isReady = ref(false);
  const parseError = ref<string | null>(null);
  /**
   * Latest layout result. Exposed so consumers (PageIndicator, scroll-to-page)
   * can read page count + per-page geometry without re-running the engine.
   * Mirrors React's pagedEditorRef.current.getLayout().
   */
  const layout = shallowRef<Layout | null>(null);

  // Use the singleton extension manager — same schema used by toProseDoc/commands
  const mgr = singletonManager;

  // ========================================================================
  // Layout pipeline
  // ========================================================================

  function runLayoutPipeline(state: EditorState) {
    const container = pagesContainer.value;
    if (!container || !document.value) return;
    const layoutSeq = syncCoordinator?.getStateSeq() ?? 0;
    syncCoordinator?.onLayoutStart();

    const body = document.value.package?.document;
    // Initial geometry comes from the FIRST section's properties; the trailing
    // section uses `finalSectionProperties`. Mirrors React's PagedEditor split
    // so multi-section docs paginate the lead pages with the correct margins.
    const initialSp = body?.sections?.[0]?.properties ?? body?.finalSectionProperties ?? null;
    const finalSp = body?.finalSectionProperties ?? initialSp;
    const pageSize = getPageSize(initialSp);
    let margins = getMargins(initialSp);
    const finalPageSize = getPageSize(finalSp);
    let finalMargins = getMargins(finalSp);
    const contentWidth = pageSize.w - margins.left - margins.right;
    const pageContentHeight = pageSize.h - margins.top - margins.bottom;
    const theme = document.value.package?.theme ?? null;
    const styles = document.value.package?.styles ?? null;

    try {
      // Step 1: PM doc → flow blocks
      const blocks = buildBoxTree(state.doc, { theme, pageContentHeight });

      // Step 2: Measure blocks
      const measures = measureBlocks(blocks, contentWidth);

      // Step 3: Resolve and measure header/footer content (#400 port).
      // Routes through the shared core helper so HF rendering matches
      // React's PagedEditor byte-for-byte.
      const { header, footer, firstHeader, firstFooter } = resolveHeaderFooter(
        document.value,
        initialSp
      );
      const hfMetricsHeader = { section: 'header' as const, pageSize, margins };
      const hfMetricsFooter = { section: 'footer' as const, pageSize, margins };
      // Core's `convertHeaderFooterToContent` (post-#379-382) takes a
      // single options object with `measureBlocks` (plural) instead of
      // the per-block callback the earlier version used. The pipeline
      // calls `measureBlocks(normalizedBlocks, contentWidth)` once per
      // HF flow.
      const defaultTabMarkTwips = state.doc.attrs?.defaultTabMarkTwips as number | null;
      const hfOptions = { styles, theme, measureBlocks, defaultTabMarkTwips };

      // HF unification (openspec changes/unify-hf-editing): when a
      // persistent hidden HF EditorView is mounted for a HeaderFooter,
      // route through `convertHeaderFooterPmDocToContent` so the painter
      // reflects the PM's live doc instead of the Document model snapshot.
      // Mirror of React's `useLayoutPipeline.convertHf` branch.
      const convertHf = (
        hf: import('@eigenpal/docx-editor-core/types/document').HeaderFooter | null | undefined,
        metrics: typeof hfMetricsHeader | typeof hfMetricsFooter
      ): HeaderFooterContent | undefined => {
        if (!hf) return undefined;
        const view = getHfPmView(hf);
        if (view) {
          return convertHeaderFooterPmDocToContent(
            view.state.doc,
            contentWidth,
            metrics,
            hfOptions
          );
        }
        return convertHeaderFooterToContent(hf, contentWidth, metrics, hfOptions);
      };

      const headerContent = convertHf(header, hfMetricsHeader);
      const footerContent = convertHf(footer, hfMetricsFooter);
      const hasTitlePg = initialSp?.titlePg === true;
      const firstPageHeaderContent = hasTitlePg
        ? convertHf(firstHeader, hfMetricsHeader)
        : undefined;
      const firstPageFooterContent = hasTitlePg
        ? convertHf(firstFooter, hfMetricsFooter)
        : undefined;

      // Step 4: Extend margins when HF content overflows the authored
      // header/footer space (#400 port). Apply the extension to body
      // margins, finalMargins, AND every per-`sectionBreak.margins` so
      // multi-section docs paginate correctly — the layout engine prefers
      // sb.margins over the body fallback.
      const headerDistance = margins.header ?? 48;
      const footerDistance = margins.footer ?? 48;
      const availableHeaderSpace = margins.top - headerDistance;
      const availableFooterSpace = margins.bottom - footerDistance;
      const hfHeight = (hf: HeaderFooterContent | undefined) =>
        hf ? (hf.visualBottom ?? hf.height) : 0;
      const hfFooterHeight = (hf: HeaderFooterContent | undefined) =>
        hf ? Math.max((hf.visualBottom ?? hf.height) - (hf.visualTop ?? 0), hf.height) : 0;
      const headerContentHeight = Math.max(
        hfHeight(headerContent),
        hfHeight(firstPageHeaderContent)
      );
      const footerContentHeight = Math.max(
        hfFooterHeight(footerContent),
        hfFooterHeight(firstPageFooterContent)
      );
      const extendHeader = headerContentHeight > availableHeaderSpace;
      const extendFooter = footerContentHeight > availableFooterSpace;
      if (extendHeader || extendFooter) {
        const extend = (m: PageMargins): PageMargins => {
          const out = { ...m };
          if (extendHeader) out.top = Math.max(m.top, headerDistance + headerContentHeight);
          if (extendFooter) out.bottom = Math.max(m.bottom, footerDistance + footerContentHeight);
          return out;
        };
        margins = extend(margins);
        finalMargins = extend(finalMargins);
        for (const block of blocks) {
          if (block.kind !== 'sectionBreak') continue;
          const sb = block as SectionMarkerBlock;
          if (sb.margins) sb.margins = extend(sb.margins);
        }
      }

      // Step 5: Layout. Two-pass when footnotes exist so per-page reserved
      // heights can be subtracted from the page content area on pass 2.
      const layoutOpts = {
        pageSize,
        margins,
        finalPageSize,
        finalMargins,
        pageGap,
      };

      const footnoteRefs = collectFootnoteRefs(blocks);
      const hasFootnotes = footnoteRefs.length > 0 && !!document.value.package?.footnotes;

      let newLayout = layOutPages(blocks, measures, layoutOpts);
      let pageFootnoteMap = new Map<number, number[]>();
      let footnoteContentMap = new Map<number, FootnoteContent>();

      if (hasFootnotes) {
        // post-#378 footnote pipeline: pass styles/theme/measureBlocks
        // through so footnote content is built via the body pipeline.
        footnoteContentMap = buildFootnoteContentMap(
          document.value.package!.footnotes!,
          footnoteRefs,
          contentWidth,
          { styles, theme, measureBlocks, defaultTabMarkTwips }
        );

        // Pass 2+: multi-pass convergence loop lives in core so the React
        // + Vue adapters stay in lockstep (see #485).
        const stabilized = stabilizeFootnoteLayout({
          blocks,
          measures,
          layoutOpts,
          footnoteRefs,
          footnoteContentMap,
          initialLayout: newLayout,
        });
        newLayout = stabilized.layout;
        pageFootnoteMap = stabilized.pageFootnoteMap;
      }

      layout.value = newLayout;

      // Step 6: Build block lookup and paint
      const blockLookup: BlockLookup = new Map();
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const measure = measures[i];
        if (block && measure) {
          blockLookup.set(String(block.id), { block, measure });
        }
      }

      const footnotesByPage = hasFootnotes
        ? buildFootnoteRenderItems(pageFootnoteMap, footnoteContentMap, document.value)
        : undefined;

      paintPages(newLayout.pages, container, {
        pageGap,
        showShadow: true,
        pageBackground: '#fff',
        blockLookup,
        theme,
        headerContent,
        footerContent,
        firstPageHeaderContent,
        firstPageFooterContent,
        titlePage: hasTitlePg,
        footnotesByPage,
      } as Parameters<typeof paintPages>[2]);

      // paintPages sets display:flex on the container — fix scrolling
      container.style.overflowY = 'auto';
      container.style.minHeight = '0';
      // Prevent page elements from stretching to fill the flex container
      for (const child of Array.from(container.children)) {
        (child as HTMLElement).style.flexShrink = '0';
      }
    } catch (err) {
      console.error('[useDocxEditor] Layout pipeline error:', err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      syncCoordinator?.onLayoutComplete(layoutSeq);
    }
  }

  // ========================================================================
  // ProseMirror setup
  // ========================================================================

  function createEditorView() {
    const host = hiddenContainer.value;
    if (!host) return;

    const docStyles = document.value?.package?.styles;
    const doc = document.value
      ? toProseDoc(document.value, { styles: docStyles ?? undefined })
      : createEmptyDoc();

    // Suggestion-mode plugin is registered inactive; `setSuggestionMode()`
    // toggles its `active` state via PluginKey meta. Mirrors React's
    // mount-once-and-toggle pattern (DocxEditor.tsx createSuggestionModePlugin).
    const suggestionPlugin = createSuggestionModePlugin(false);
    // Expose the document's styles to style-aware commands (e.g. the Enter
    // handler's `w:next` switch from heading to body text). Mirrors React's
    // OffscreenEditorHost createInitialState.
    const styleResolverPlugin = createDocumentStylesPlugin(docStyles);
    const plugins: Plugin[] = [
      suggestionPlugin,
      ...externalPlugins,
      ...(mgr.getPlugins() ?? []),
      styleResolverPlugin,
    ];

    const state = EditorState.create({
      doc,
      schema: mgr.getSchema(),
      plugins,
    });
    editorState.value = state;

    const view = new EditorView(host, {
      state,
      editable: () => !unref(readOnly),
      dispatchTransaction(transaction: Transaction) {
        if (!view) return;
        const newState = view.state.apply(transaction);
        view.updateState(newState);
        editorState.value = newState;

        // Snapshot marks at cursor for reactive toolbar state.
        // Re-layout on doc changes
        if (transaction.docChanged) {
          syncCoordinator?.incrementStateSeq();
          runLayoutPipeline(newState);
          // Notify parent about document change
          try {
            if (document.value) {
              const updatedDoc = fromProseDoc(newState.doc, document.value);
              document.value = updatedDoc;
              onChange?.(updatedDoc);
            }
          } catch (err) {
            console.error('[useDocxEditor] fromProseDoc error:', err);
          }
        }

        // Notify about selection changes (for highlight overlay)
        syncCoordinator?.requestRender();
        onSelectionUpdate?.();
      },
    });

    editorView.value = view;
    isReady.value = true;

    // Initial layout
    runLayoutPipeline(state);
    syncCoordinator?.requestRender();
  }

  // Sync editorMode/author to the mounted suggestion-mode plugin.
  // Mirrors React's DocxEditor.tsx useEffect that calls setSuggestionMode
  // whenever editingMode or author changes. Without this watch, the Vue
  // `mode="suggesting"` prop would not actually activate the plugin —
  // typed text would land as plain edits.
  watch(
    [() => unref(editorMode), () => unref(author), editorView],
    ([mode, who, view]) => {
      if (!view) return;
      setSuggestionMode(mode === 'suggesting', view.state, view.dispatch, who);
    },
    { immediate: true }
  );

  function destroyEditorView() {
    if (editorView.value) {
      editorView.value.destroy();
      editorView.value = null;
    }
    editorState.value = null;
    isReady.value = false;
  }

  // ========================================================================
  // Persistent header/footer PMs (Vue parity for #468 unification, openspec
  // changes/unify-hf-editing). One off-screen EditorView per distinct
  // `rId` in `Document.package.headers ∪ package.footers`. The painter
  // reads from `view.state.doc` via `convertHeaderFooterPmDocToContent`
  // so HF edits live-render in the painter without a second visible PM.
  // ========================================================================

  /** Off-screen host that owns all HF EditorView DOM. */
  const hfHostRef: { current: HTMLDivElement | null } = { current: null };
  /** rId → mounted EditorView. */
  const hfViews = new Map<string, EditorView>();
  /** rId → ExtensionManager owning the view's plugins/commands. */
  const hfManagers = new Map<string, ExtensionManager>();

  function ensureHfHost(): HTMLDivElement {
    if (hfHostRef.current && hfHostRef.current.isConnected) return hfHostRef.current;
    const host = window.document.createElement('div');
    host.dataset.hfHost = 'true';
    host.style.cssText =
      'position: fixed; left: -9999px; top: 0; opacity: 0; z-index: -1; pointer-events: none;';
    window.document.body.appendChild(host);
    hfHostRef.current = host;
    return host;
  }

  /**
   * Resolve a HeaderFooter instance to its `rId` by walking
   * `Document.package.headers/footers`. Identity match — both maps share
   * a single HeaderFooter object per `rId` across sections that reference
   * it (the spec-faithful sharing-by-reference pattern). Returns null
   * when the doc is unloaded or the HF isn't currently in the package
   * (e.g. just removed).
   */
  function findHfRid(
    hf: import('@eigenpal/docx-editor-core/types/document').HeaderFooter
  ): string | null {
    const pkg = document.value?.package;
    if (!pkg) return null;
    if (pkg.headers) {
      for (const [rId, value] of pkg.headers) if (value === hf) return rId;
    }
    if (pkg.footers) {
      for (const [rId, value] of pkg.footers) if (value === hf) return rId;
    }
    return null;
  }

  /**
   * Public lookup used by the inline overlay + click router. Returns the
   * persistent EditorView for the HF instance, or null when no PM is yet
   * mounted (cold boot, or the HF was just materialised at runtime).
   */
  function getHfPmView(
    hf: import('@eigenpal/docx-editor-core/types/document').HeaderFooter
  ): EditorView | null {
    const rId = findHfRid(hf);
    if (!rId) return null;
    return hfViews.get(rId) ?? null;
  }

  /**
   * Mount missing HF EditorViews and tear down stale ones to match the
   * current `Document.package.headers/footers`. Called on every document
   * load + after the inline overlay's save (`package.headers` swap).
   */
  function syncHfPMs() {
    const pkg = document.value?.package;
    const host = ensureHfHost();
    const wantRIds = new Set<string>();
    if (pkg?.headers) for (const rId of pkg.headers.keys()) wantRIds.add(rId);
    if (pkg?.footers) for (const rId of pkg.footers.keys()) wantRIds.add(rId);

    // Tear down rIds no longer present (e.g. user removed a header).
    for (const [rId, view] of hfViews) {
      if (!wantRIds.has(rId)) {
        view.destroy();
        view.dom.parentElement?.remove();
        hfManagers.get(rId)?.destroy();
        hfManagers.delete(rId);
        hfViews.delete(rId);
      }
    }

    // Bring up new ones. Each gets its own ExtensionManager — history /
    // input rules plugins are per-EditorView and can't be shared.
    if (!pkg) return;
    const styles = pkg.styles ?? null;
    const theme = pkg.theme ?? null;
    // Read from package.settings (canonical) not editorState (race on first sync).
    const defaultTabMarkTwips = pkg.settings?.defaultTabMark ?? null;
    for (const rId of wantRIds) {
      if (hfViews.has(rId)) continue;
      const hf = pkg.headers?.get(rId) ?? pkg.footers?.get(rId);
      if (!hf) continue;
      const kind = pkg.headers?.has(rId) ? 'header' : 'footer';

      const mgr = new ExtensionManager(createStarterKit());
      mgr.buildSchema();
      mgr.initializeRuntime();
      hfManagers.set(rId, mgr);

      const node = window.document.createElement('div');
      node.dataset.hfRId = rId;
      node.dataset.hfKind = kind;
      host.appendChild(node);

      const pmDoc = headerFooterToProseDoc(hf.content, {
        styles: styles ?? undefined,
        theme,
        defaultTabMarkTwips,
      });
      // Header/footer paragraphs share the document's style table, so they get
      // the same style-aware behavior (e.g. Enter after a heading → body text).
      const hfStyleResolverPlugin = createDocumentStylesPlugin(styles);
      const state = EditorState.create({
        doc: pmDoc,
        schema,
        plugins: [...mgr.getPlugins(), hfStyleResolverPlugin],
      });
      const slotKind = kind;
      const view: EditorView = new EditorView(node, {
        state,
        dispatchTransaction(tr) {
          const newState = view.state.apply(tr);
          view.updateState(newState);
          // Writeback: sync `view.state.doc` into
          // `Document.package.headers[rId].content` (or `.footers[rId].content`)
          // so `save()` reads the latest HF content. Without this the
          // persistent PM holds edits the saved DOCX doesn't.
          if (tr.docChanged) {
            const pkg = document.value?.package;
            const bag = slotKind === 'header' ? pkg?.headers : pkg?.footers;
            const hf = bag?.get(rId);
            if (hf) hf.content = proseDocToBlocks(newState.doc);
          }
          // Only re-layout when the HF doc actually changed — selection-only
          // transactions don't move text so the painter has nothing new.
          if (tr.docChanged && editorState.value) runLayoutPipeline(editorState.value);
          onHfTransactionRef.value?.(rId, view, tr.docChanged);
        },
      });
      hfViews.set(rId, view);
    }
  }

  function destroyHfPMs() {
    for (const view of hfViews.values()) {
      view.destroy();
      view.dom.parentElement?.remove();
    }
    hfViews.clear();
    for (const mgr of hfManagers.values()) mgr.destroy();
    hfManagers.clear();
    if (hfHostRef.current) {
      hfHostRef.current.remove();
      hfHostRef.current = null;
    }
  }

  // Listener slot — DocxEditor.vue subscribes here to update caret + UI
  // chrome on every HF transaction. Held in a ref so swapping it doesn't
  // require resetting the `dispatchTransaction` closure on each EditorView.
  const onHfTransactionRef: {
    value: ((rId: string, view: EditorView, docChanged: boolean) => void) | null;
  } = {
    value: null,
  };
  function setHfTransactionListener(
    cb: ((rId: string, view: EditorView, docChanged: boolean) => void) | null
  ) {
    onHfTransactionRef.value = cb;
  }

  // ========================================================================
  // Document loading
  // ========================================================================

  async function loadBuffer(buffer: ArrayBuffer | Uint8Array | Blob | File) {
    parseError.value = null;
    isReady.value = false;

    try {
      let arrayBuf: ArrayBuffer;
      if (buffer instanceof Blob || buffer instanceof File) {
        arrayBuf = await buffer.arrayBuffer();
      } else if (buffer instanceof Uint8Array) {
        arrayBuf = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer;
      } else {
        arrayBuf = buffer;
      }

      const doc = await parseDocx(arrayBuf);
      document.value = doc;

      // Recreate PM view with new document
      destroyEditorView();
      destroyHfPMs();
      createEditorView();
      syncHfPMs();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      parseError.value = error.message;
      onError?.(error);
    }
  }

  function loadDocument(doc: Document) {
    parseError.value = null;
    document.value = doc;
    destroyEditorView();
    destroyHfPMs();
    createEditorView();
    syncHfPMs();
  }

  // ========================================================================
  // Public API
  // ========================================================================

  async function save(): Promise<Blob | null> {
    if (!editorView.value || !document.value) return null;

    const { repackDocx, createDocx } = await import('@eigenpal/docx-editor-core/docx/rezip');
    const { injectReplyRangeMarkers, injectTCReplyRangeMarkers } =
      await import('@eigenpal/docx-editor-core/docx');

    const updatedDoc = fromProseDoc(editorView.value.state.doc, document.value);
    // Word/Pages need parallel `commentRangeStart`/`End` markers for
    // every reply (regular comment replies AND tracked-change replies)
    // in document.xml. Without them the saved doc loses replies. Same
    // step React runs in its `handleSave` (DocxEditor.tsx).
    const comments = updatedDoc.package.document?.comments ?? [];
    if (updatedDoc.package.document?.content && comments.length > 0) {
      injectReplyRangeMarkers(updatedDoc.package.document.content, comments);
      injectTCReplyRangeMarkers(updatedDoc.package.document.content, comments);
    }

    let buffer: ArrayBuffer;
    if (updatedDoc.originalBuffer) {
      buffer = await repackDocx(updatedDoc);
    } else {
      buffer = await createDocx(updatedDoc);
    }
    return new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  function focus() {
    editorView.value?.focus();
  }

  function destroy() {
    destroyEditorView();
    destroyHfPMs();
    document.value = null;
  }

  function getDocument(): Document | null {
    return document.value;
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  onBeforeUnmount(() => {
    destroy();
  });

  function getCommands() {
    return mgr.getCommands();
  }

  return {
    // State
    editorView,
    editorState,
    isReady,
    parseError,
    layout,

    // Actions
    loadBuffer,
    loadDocument,
    save,
    focus,
    destroy,
    getDocument,
    getCommands,
    /** Force a re-layout without a doc change (e.g. after page-setup changes). */
    reLayout() {
      if (editorView.value) runLayoutPipeline(editorView.value.state);
    },

    // HF unification surface — phase 6 of openspec/changes/unify-hf-editing.
    getHfPmView,
    syncHfPMs,
    setHfTransactionListener,
    /**
     * Publish a fresh Document object — used by HF materialisation in
     * usePagesPointer to push a new doc identity that watchers can observe.
     */
    setDocument(doc: Document) {
      document.value = doc;
    },
  };
}
