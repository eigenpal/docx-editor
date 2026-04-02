/**
 * useDocxEditor — Vue composable for the DOCX editor lifecycle.
 *
 * Manages: DOCX parsing → ProseMirror state → layout pipeline → DOM painting.
 * This is the Vue equivalent of PagedEditor + HiddenProseMirror from the React package.
 */

import { ref, onBeforeUnmount, shallowRef, type Ref } from 'vue';
import { EditorState, type Transaction, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

// Core imports — these all resolve through Vite aliases to packages/core/src/
import { parseDocx } from '@eigenpal/docx-core/docx/parser';
import { toProseDoc, createEmptyDoc } from '@eigenpal/docx-core/prosemirror/conversion';
import { fromProseDoc } from '@eigenpal/docx-core/prosemirror/conversion/fromProseDoc';
import { singletonManager } from '@eigenpal/docx-core/prosemirror/schema';
import { toFlowBlocks } from '@eigenpal/docx-core/layout-bridge/toFlowBlocks';
import { measureParagraph } from '@eigenpal/docx-core/layout-bridge/measuring';
import { layoutDocument } from '@eigenpal/docx-core/layout-engine';
import { renderPages } from '@eigenpal/docx-core/layout-painter/renderPage';
import type {
  FlowBlock,
  Measure,
  ParagraphBlock,
  TableBlock,
  TableMeasure,
  ImageBlock,
  PageMargins,
} from '@eigenpal/docx-core/layout-engine/types';
import type { BlockLookup } from '@eigenpal/docx-core/layout-painter';
import type { Document, SectionProperties } from '@eigenpal/docx-core/types/document';

// ProseMirror CSS — must be imported for the hidden editor to work
import 'prosemirror-view/style/prosemirror.css';
import '@eigenpal/docx-core/prosemirror/editor.css';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PAGE_WIDTH = 816; // 8.5in at 96dpi
const DEFAULT_PAGE_HEIGHT = 1056; // 11in at 96dpi
const DEFAULT_MARGINS: PageMargins = { top: 96, right: 96, bottom: 96, left: 96 };
const DEFAULT_PAGE_GAP = 24;

// ============================================================================
// HELPERS
// ============================================================================

function twipsToPixels(twips: number): number {
  return Math.round((twips / 1440) * 96);
}

function getPageSize(sp: SectionProperties | null | undefined) {
  return {
    w: sp?.pageWidth ? twipsToPixels(sp.pageWidth) : DEFAULT_PAGE_WIDTH,
    h: sp?.pageHeight ? twipsToPixels(sp.pageHeight) : DEFAULT_PAGE_HEIGHT,
  };
}

function getMargins(sp: SectionProperties | null | undefined): PageMargins {
  return {
    top: sp?.marginTop ? twipsToPixels(sp.marginTop) : DEFAULT_MARGINS.top,
    right: sp?.marginRight ? twipsToPixels(sp.marginRight) : DEFAULT_MARGINS.right,
    bottom: sp?.marginBottom ? twipsToPixels(sp.marginBottom) : DEFAULT_MARGINS.bottom,
    left: sp?.marginLeft ? twipsToPixels(sp.marginLeft) : DEFAULT_MARGINS.left,
  };
}

/**
 * Simplified block measurement (no floating zone support for the minimal harness).
 * Contributors can port the full measureBlocks from PagedEditor later.
 */
function measureBlock(block: FlowBlock, contentWidth: number): Measure {
  switch (block.kind) {
    case 'paragraph':
      return measureParagraph(block as ParagraphBlock, contentWidth);

    case 'table': {
      const tb = block as TableBlock;
      let columnWidths = tb.columnWidths ?? [];
      if (columnWidths.length === 0 && tb.rows.length > 0) {
        const colCount = tb.rows[0].cells.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0);
        const equalWidth = contentWidth / Math.max(1, colCount);
        columnWidths = Array(colCount).fill(equalWidth);
      }

      const rows = tb.rows.map((row) => {
        let colIdx = 0;
        const cells = row.cells.map((cell) => {
          const colSpan = cell.colSpan ?? 1;
          let cellWidth = 0;
          for (let c = 0; c < colSpan && colIdx + c < columnWidths.length; c++) {
            cellWidth += columnWidths[colIdx + c] ?? 0;
          }
          if (cellWidth === 0) cellWidth = cell.width ?? 100;
          colIdx += colSpan;

          const cellContentWidth = Math.max(1, cellWidth - 14); // ~7px padding each side
          const blocks = cell.blocks.map((b) => measureBlock(b, cellContentWidth));
          const height =
            blocks.reduce(
              (h, m) => h + ('totalHeight' in m ? (m as { totalHeight: number }).totalHeight : 0),
              0
            ) + 2; // padding

          return { blocks, width: cellWidth, height, colSpan: cell.colSpan, rowSpan: cell.rowSpan };
        });

        const maxHeight = Math.max(24, ...cells.map((c) => c.height));
        return { cells, height: maxHeight };
      });

      const totalWidth = columnWidths.reduce((s, w) => s + w, 0) || contentWidth;
      const totalHeight = rows.reduce((h, r) => h + r.height, 0);
      return { kind: 'table', rows, columnWidths, totalWidth, totalHeight } as TableMeasure;
    }

    case 'image': {
      const ib = block as ImageBlock;
      return { kind: 'image', width: ib.width ?? 100, height: ib.height ?? 100 };
    }

    case 'pageBreak':
      return { kind: 'pageBreak' };

    case 'columnBreak':
      return { kind: 'columnBreak' };

    case 'sectionBreak':
      return { kind: 'sectionBreak' };

    default:
      return { kind: 'paragraph', lines: [], totalHeight: 0 };
  }
}

function measureBlocks(blocks: FlowBlock[], contentWidth: number): Measure[] {
  return blocks.map((b) => measureBlock(b, contentWidth));
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
  readOnly?: boolean;
  /** Page gap in pixels */
  pageGap?: number;
  /** Callback on document change */
  onChange?: (doc: Document) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Callback on selection change */
  onSelectionUpdate?: () => void;
}

export function useDocxEditor(options: UseDocxEditorOptions) {
  const {
    hiddenContainer,
    pagesContainer,
    readOnly = false,
    pageGap = DEFAULT_PAGE_GAP,
    onChange,
    onError,
    onSelectionUpdate,
  } = options;

  // State
  const document = shallowRef<Document | null>(null);
  const editorView = shallowRef<EditorView | null>(null);
  const isReady = ref(false);
  const parseError = ref<string | null>(null);
  /** Reactive snapshot of marks at cursor/selection-start, updated on every transaction */
  const cursorMarks = ref<{ name: string; attrs: Record<string, any> }[]>([]);

  // Use the singleton extension manager — same schema used by toProseDoc/commands
  const mgr = singletonManager;

  // ========================================================================
  // Layout pipeline
  // ========================================================================

  function runLayoutPipeline(state: EditorState) {
    const container = pagesContainer.value;
    if (!container || !document.value) return;

    const sp = document.value.package?.document?.finalSectionProperties ?? null;
    const pageSize = getPageSize(sp);
    const margins = getMargins(sp);
    const contentWidth = pageSize.w - margins.left - margins.right;
    const pageContentHeight = pageSize.h - margins.top - margins.bottom;
    const theme = document.value.package?.theme ?? null;

    try {
      // Step 1: PM doc → flow blocks
      const blocks = toFlowBlocks(state.doc, { theme, pageContentHeight });

      // Step 2: Measure blocks
      const measures = measureBlocks(blocks, contentWidth);

      // Step 3: Layout
      const newLayout = layoutDocument(blocks, measures, { pageSize, margins });

      // Step 4: Build block lookup and paint
      const blockLookup: BlockLookup = new Map();
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const measure = measures[i];
        if (block && measure) {
          blockLookup.set(String(block.id), { block, measure });
        }
      }

      renderPages(newLayout.pages, container, {
        pageGap,
        showShadow: true,
        pageBackground: '#fff',
        blockLookup,
        theme,
      } as Parameters<typeof renderPages>[2]);

      // renderPages sets display:flex on the container — fix scrolling
      container.style.overflowY = 'auto';
      container.style.minHeight = '0';
      // Prevent page elements from stretching to fill the flex container
      for (const child of Array.from(container.children)) {
        (child as HTMLElement).style.flexShrink = '0';
      }
    } catch (err) {
      console.error('[useDocxEditor] Layout pipeline error:', err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ========================================================================
  // ProseMirror setup
  // ========================================================================

  function createEditorView() {
    const host = hiddenContainer.value;
    if (!host) return;

    const doc = document.value
      ? toProseDoc(document.value, {
          styles: document.value.package?.styles ?? undefined,
        })
      : createEmptyDoc();

    const plugins: Plugin[] = [...(mgr.getPlugins() ?? [])];

    const state = EditorState.create({
      doc,
      schema: mgr.getSchema(),
      plugins,
    });

    const view = new EditorView(host, {
      state,
      editable: () => !readOnly,
      dispatchTransaction(transaction: Transaction) {
        if (!view) return;
        const newState = view.state.apply(transaction);
        view.updateState(newState);

        // Snapshot marks at cursor for reactive toolbar state.
        // Must happen before any code that could throw.
        // NOTE: $from.marks() at a text node boundary can return marks from the
        // node BEFORE the selection start. For non-empty selections, read marks
        // from the first text node inside the selection range instead.
        let marks: readonly import('prosemirror-model').Mark[] = [];
        if (newState.storedMarks) {
          marks = newState.storedMarks;
        } else {
          const { from, to, empty } = newState.selection;
          if (empty) {
            marks = newState.selection.$from.marks();
          } else {
            // Read marks from first text node in selection range
            newState.doc.nodesBetween(from, Math.min(from + 1, to), (node) => {
              if (node.isText) {
                marks = node.marks;
                return false; // stop
              }
            });
            if (!marks.length) marks = newState.selection.$from.marks();
          }
        }
        cursorMarks.value = marks.map(m => ({ name: m.type.name, attrs: { ...m.attrs } }));

        // Re-layout on doc changes
        if (transaction.docChanged) {
          runLayoutPipeline(newState);
          // Notify parent about document change
          try {
            if (document.value) {
              const updatedDoc = fromProseDoc(newState.doc, document.value);
              onChange?.(updatedDoc);
            }
          } catch (err) {
            console.error('[useDocxEditor] fromProseDoc error:', err);
          }
        }

        // Notify about selection changes (for highlight overlay)
        onSelectionUpdate?.();
      },
    });

    editorView.value = view;
    isReady.value = true;

    // Initial layout
    runLayoutPipeline(state);
  }

  function destroyEditorView() {
    if (editorView.value) {
      editorView.value.destroy();
      editorView.value = null;
    }
    isReady.value = false;
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
      createEditorView();
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
    createEditorView();
  }

  // ========================================================================
  // Public API
  // ========================================================================

  async function save(): Promise<Blob | null> {
    if (!editorView.value || !document.value) return null;

    const { repackDocx, createDocx } = await import('@eigenpal/docx-core/docx/rezip');

    const updatedDoc = fromProseDoc(editorView.value.state.doc, document.value);
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
    isReady,
    parseError,
    cursorMarks,

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
  };
}
