declare global {
  interface Window {
    __DOCX_EDITOR_E2E__?: DocxEditorE2EHook;
  }
}

import type { Editor, EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type {
  PaginatedSurfacePerf,
  SurfaceEditingMode,
} from '../../../../packages/core/src/editor/paginated-surface-contract.ts';
import {
  findTableInteractionAt,
  tableInteractionIndex,
} from '../../../../packages/core/src/layout/semantic-table-interaction.ts';
import {
  paragraphTextFromLayout,
  type SemanticLayout,
  type TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import {
  canonicalOoxmlFingerprint,
  diffSemanticDigests,
  paragraphTextOf,
  readOoxmlPackage,
  semanticDigest,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  detailedTableSnapshot,
  findInnerTable,
  findTallInnerTable,
  findMergedTable,
  findOuterTable,
  outerTableIsolationEqual,
  readTableEditingPackage,
  readTableEditingReadbackFromPart,
  tableSnapshot,
  type DetailedTableSnapshot,
  type TableEditingReadback,
} from '../../../../e2e/fixtures/table-editing-assertions.ts';

export interface DocxEditorE2EHook {
  ready(): boolean;
  getEditor(): Editor | null;
  saveBytes(): Promise<Uint8Array | null>;
  saveAndReopen(): Promise<{ ok: true } | { ok: false; reason: string }>;
  remountAtZoom(zoom: number): Promise<{ ok: true } | { ok: false; reason: string }>;
  readback(): TableEditingReadback | null;
  fingerprint(): string | null;
  semanticDigestDiff(expectedBytes: Uint8Array): readonly string[] | null;
  getSelectedTable(): ReturnType<Editor['getSelectedTable']> | null;
  getCellSelection(): ReturnType<Editor['getTableCellSelection']> | null;
  can(command: EditorCommand): ReturnType<Editor['can']>;
  setZoom(zoom: number): ReturnType<Editor['setZoom']>;
  getZoom(): number | null;
  getRenderScale(): number | null;
  canUndo(): boolean;
  canRedo(): boolean;
  tableTopology(
    marker: 'inner' | 'outer' | 'merged' | 'tall'
  ): ReturnType<typeof tableSnapshot> | null;
  detailedTopology(marker: 'inner' | 'outer' | 'merged' | 'tall'): DetailedTableSnapshot | null;
  outerTableIsolationEqual(bytes: Uint8Array): boolean;
  scrollToParagraph(needle: string): boolean;
  layoutRevision(): number | null;
  fontMeasurer(): 'fixed' | 'shaped' | null;
  prepareEditBenchmark(
    fraction: number,
    mode: SurfaceEditingMode,
    offsetFraction?: number
  ): {
    paragraphId: string;
    offset: number;
    textLength: number;
    revision: number;
    pageCount: number;
  } | null;
  benchmarkPerf(): PaginatedSurfacePerf | null;
  benchmarkSelection(): {
    readonly anchor: { readonly paragraphId: string; readonly offset: number };
    readonly head: { readonly paragraphId: string; readonly offset: number };
  } | null;
  benchmarkParagraphText(paragraphId: string): string | null;
  benchmarkParagraphModelText(paragraphId: string): string | null;
  prepareClipboardBenchmark(
    startFraction: number,
    endFraction: number
  ): { readonly expectedText: string; readonly pageCount: number } | null;
  undoBenchmarkEdit(): boolean;
  innerTableId(): string | null;
  outerTableId(): string | null;
  tableEdgePoint(
    tableMarker: 'inner' | 'outer' | 'merged' | 'tall',
    kind: 'divider' | 'right-edge' | 'insert-row' | 'insert-column',
    options?: { dividerIndex?: number; row?: number; column?: number }
  ): { x: number; y: number; pageIndex: number } | null;
  cellCenterPoint(
    tableMarker: 'inner' | 'outer' | 'merged' | 'tall',
    row: number,
    column: number
  ): { x: number; y: number; pageIndex: number } | null;
  clickParagraph(needle: string): boolean;
}

function surface(editor: Editor | null) {
  return (editor as DocxEditorInstance | null)?.surface ?? null;
}

function documentPart(editor: Editor | null): OoxmlPart | null {
  const session = surface(editor)?.session;
  return session ? session.part() : null;
}

function tableByMarker(part: OoxmlPart, marker: 'inner' | 'outer' | 'merged' | 'tall') {
  if (marker === 'inner') return findInnerTable(part);
  if (marker === 'outer') return findOuterTable(part);
  if (marker === 'tall') return findTallInnerTable(part);
  return findMergedTable(part);
}

function findTableFragment(layout: SemanticLayout, tableId: string): TableFragmentRecord | null {
  const visitBlocks = (blocks: readonly { kind: string }[]): TableFragmentRecord | null => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        const table = block as TableFragmentRecord;
        if (table.tableId === tableId) return table;
        for (const row of table.rows) {
          for (const cell of row.cells) {
            const nested = visitBlocks(cell.blocks);
            if (nested) return nested;
          }
        }
      }
    }
    return null;
  };
  for (const page of layout.pages) {
    const match = visitBlocks(page.fragments);
    if (match) return match;
  }
  return null;
}

function pageIndexForTable(layout: SemanticLayout, tableId: string): number {
  const hasTable = (blocks: readonly { kind: string; tableId?: string }[]): boolean => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        if (block.tableId === tableId) return true;
        for (const row of (block as TableFragmentRecord).rows) {
          for (const cell of row.cells) {
            if (hasTable(cell.blocks)) return true;
          }
        }
      }
    }
    return false;
  };
  return layout.pages.findIndex((page) => hasTable(page.fragments));
}

function pageOffsetXFor(layout: SemanticLayout, pageIndex: number): number {
  let width = 0;
  for (const page of layout.pages) {
    width = Math.max(width, page.box.x + page.box.width);
  }
  const page = layout.pages[pageIndex];
  if (!page) return 0;
  const widths = new Set(layout.pages.map((candidate) => candidate.box.width));
  if (widths.size <= 1) return 0;
  return (width - page.box.width) / 2 - page.box.x;
}

function clientPoint(
  editor: Editor | null,
  layout: SemanticLayout,
  pages: HTMLElement,
  pageIndex: number,
  contentX: number,
  contentY: number
): { x: number; y: number; pageIndex: number } {
  const page = layout.pages[pageIndex >= 0 ? pageIndex : 0]!;
  const scale = editor?.getRenderScale() ?? 96 / 72;
  const offsetX = pageOffsetXFor(layout, pageIndex);
  const rect = pages.getBoundingClientRect();
  const sheetX = page.contentBox.x + contentX + offsetX;
  const sheetY = page.contentBox.y + contentY;
  return {
    x: rect.left + sheetX * scale,
    y: rect.top + sheetY * scale,
    pageIndex: pageIndex >= 0 ? pageIndex : 0,
  };
}

export function createDocxEditorE2EHook(getEditor: () => Editor | null): DocxEditorE2EHook {
  return {
    ready: () => getEditor() !== null,
    getEditor,
    async saveBytes() {
      const editor = getEditor();
      if (!editor) return null;
      const buffer = await editor.save();
      return buffer ? new Uint8Array(buffer) : null;
    },
    async saveAndReopen() {
      const editor = getEditor();
      if (!editor) return { ok: false, reason: 'no editor' };
      const buffer = await editor.save();
      if (!buffer) return { ok: false, reason: 'save returned null' };
      editor.load(buffer);
      return { ok: true };
    },
    async remountAtZoom(zoom) {
      const editor = getEditor();
      if (!editor) return { ok: false, reason: 'no editor' };
      const buffer = await editor.save();
      if (!buffer) return { ok: false, reason: 'save returned null' };
      const zoomResult = editor.setZoom(zoom);
      if (!zoomResult.ok) {
        return { ok: false, reason: zoomResult.reason ?? 'setZoom failed' };
      }
      editor.load(buffer);
      return { ok: true };
    },
    readback() {
      const part = documentPart(getEditor());
      if (!part) return null;
      return readTableEditingReadbackFromPart(part);
    },
    fingerprint() {
      const part = documentPart(getEditor());
      return part ? canonicalOoxmlFingerprint(part) : null;
    },
    semanticDigestDiff(expectedBytes) {
      const part = documentPart(getEditor());
      if (!part) return null;
      const opened = readOoxmlPackage(expectedBytes, {});
      if (!opened.ok) return [`package: ${opened.reason}`];
      const expectedPart = opened.package.parts.get(opened.package.mainDocumentPart);
      if (!expectedPart) return ['word/document.xml missing'];
      // Flattened here rather than widening the contract: this value crosses into the spec as
      // a diagnostic to print, and the two refusals above are already strings.
      return diffSemanticDigests(semanticDigest([expectedPart]), semanticDigest([part])).map(
        (difference) => `${difference.path}: ${difference.before} -> ${difference.after}`
      );
    },
    getSelectedTable() {
      return getEditor()?.getSelectedTable() ?? null;
    },
    getCellSelection() {
      return getEditor()?.getTableCellSelection() ?? null;
    },
    can(command) {
      const editor = getEditor();
      return (
        editor?.can(command) ?? { ok: false, code: 'notFound', reason: 'no editor is mounted' }
      );
    },
    setZoom(zoom) {
      const editor = getEditor();
      return (
        editor?.setZoom(zoom) ?? { ok: false, code: 'notFound', reason: 'no editor is mounted' }
      );
    },
    getZoom() {
      return getEditor()?.snapshot().zoom ?? null;
    },
    getRenderScale() {
      return getEditor()?.getRenderScale() ?? null;
    },
    canUndo() {
      return getEditor()?.snapshot().canUndo ?? false;
    },
    canRedo() {
      return getEditor()?.snapshot().canRedo ?? false;
    },
    tableTopology(marker) {
      const part = documentPart(getEditor());
      if (!part) return null;
      return tableSnapshot(tableByMarker(part, marker));
    },
    detailedTopology(marker) {
      const part = documentPart(getEditor());
      if (!part) return null;
      return detailedTableSnapshot(tableByMarker(part, marker));
    },
    outerTableIsolationEqual(bytes) {
      const afterPart = documentPart(getEditor());
      const beforePart = readTableEditingPackage(bytes);
      if (!afterPart) return false;
      return outerTableIsolationEqual(beforePart, afterPart);
    },
    scrollToParagraph(needle) {
      const scroller = document.querySelector<HTMLElement>('.docx-editor__scroll-container');
      if (!scroller) return false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const fragment = [...document.querySelectorAll('.docx-paragraph-fragment')].find((node) =>
          node.textContent?.includes(needle)
        );
        if (fragment instanceof HTMLElement) {
          fragment.scrollIntoView({ block: 'center' });
          scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
          return true;
        }
        scroller.scrollTop += scroller.clientHeight * 0.85;
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 12, bubbles: true }));
      }
      return false;
    },
    layoutRevision() {
      return surface(getEditor())?.layout().revision ?? null;
    },
    fontMeasurer() {
      const editor = getEditor() as DocxEditorInstance | null;
      return editor?.fontMeasurement().measurer ?? null;
    },
    prepareEditBenchmark(fraction, mode, offsetFraction = 0) {
      const currentSurface = surface(getEditor());
      const pages = document.querySelector<HTMLElement>('.docx-pages');
      if (!currentSurface || !pages) return null;
      const paragraphIds = currentSurface.session.paragraphIds();
      if (paragraphIds.length === 0) return null;
      const bounded = Math.min(1, Math.max(0, fraction));
      const paragraphId = paragraphIds[Math.floor((paragraphIds.length - 1) * bounded)]!;
      const textLength = paragraphTextFromLayout(currentSurface.layout(), paragraphId).length;
      const offset = Math.round(textLength * Math.min(1, Math.max(0, offsetFraction)));
      const position = { paragraphId, offset };
      currentSurface.setEditingMode(mode);
      currentSurface.setSelection({ anchor: position, head: position });
      currentSurface.revealPosition(position, { block: 'center' });
      pages.focus({ preventScroll: true });
      const state = currentSurface.state();
      return {
        paragraphId,
        offset,
        textLength,
        revision: state.revision,
        pageCount: state.pageCount,
      };
    },
    benchmarkPerf() {
      return surface(getEditor())?.state().perf ?? null;
    },
    benchmarkSelection() {
      return surface(getEditor())?.state().selection ?? null;
    },
    benchmarkParagraphText(paragraphId) {
      const currentSurface = surface(getEditor());
      return currentSurface ? paragraphTextFromLayout(currentSurface.layout(), paragraphId) : null;
    },
    benchmarkParagraphModelText(paragraphId) {
      const part = documentPart(getEditor());
      return part ? paragraphTextOf(part, paragraphId) : null;
    },
    prepareClipboardBenchmark(startFraction, endFraction) {
      const currentSurface = surface(getEditor());
      if (!currentSurface) return null;
      const ids = currentSurface.session.paragraphIds();
      if (ids.length === 0) return null;
      const at = (fraction: number) =>
        Math.floor((ids.length - 1) * Math.min(1, Math.max(0, fraction)));
      const startId = ids[Math.min(at(startFraction), at(endFraction))]!;
      const endId = ids[Math.max(at(startFraction), at(endFraction))]!;
      currentSurface.setEditingMode('edit');
      currentSurface.setSelection({
        anchor: { paragraphId: startId, offset: 0 },
        head: {
          paragraphId: endId,
          offset: paragraphTextFromLayout(currentSurface.layout(), endId).length,
        },
      });
      return {
        expectedText: currentSurface.selectedText(),
        pageCount: currentSurface.layout().pages.length,
      };
    },
    undoBenchmarkEdit() {
      const currentSurface = surface(getEditor());
      if (!currentSurface?.state().canUndo) return false;
      currentSurface.undo();
      return true;
    },
    innerTableId() {
      const part = documentPart(getEditor());
      return part ? findInnerTable(part).id : null;
    },
    outerTableId() {
      const part = documentPart(getEditor());
      return part ? findOuterTable(part).id : null;
    },
    tableEdgePoint(tableMarker, kind, options = {}) {
      const editor = getEditor();
      const currentSurface = surface(editor);
      const layout = currentSurface?.layout();
      const part = documentPart(editor);
      const pages = document.querySelector<HTMLElement>('.docx-pages');
      if (!layout || !part || !pages) return null;
      const tableId = tableByMarker(part, tableMarker).id;
      const table = findTableFragment(layout, tableId);
      if (!table) return null;
      const pageIndex = pageIndexForTable(layout, tableId);
      if (kind === 'divider') {
        const index = options.dividerIndex ?? 1;
        const row = options.row ?? 0;
        const edgeX = table.columnEdges[index] ?? table.box.width;
        const y = table.rows[row]?.box.y ?? table.box.y;
        return clientPoint(
          editor,
          layout,
          pages,
          pageIndex,
          table.box.x + edgeX,
          y + (table.rows[row]?.box.height ?? 0) / 2
        );
      }
      if (kind === 'right-edge') {
        const row = options.row ?? 0;
        const edgeX = table.columnEdges.at(-1) ?? table.box.width;
        const y = table.rows[row]?.box.y ?? table.box.y;
        return clientPoint(
          editor,
          layout,
          pages,
          pageIndex,
          table.box.x + edgeX,
          y + (table.rows[row]?.box.height ?? 0) / 2
        );
      }
      if (kind === 'insert-row') {
        const row = options.row ?? 0;
        const y = table.rows[row]?.box.y ?? table.box.y;
        const contentX = table.box.x + 4;
        const contentY = y + (table.rows[row]?.box.height ?? 0) / 2;
        const offsetX = pageOffsetXFor(layout, pageIndex);
        const page = layout.pages[pageIndex]!;
        const sheetX = page.contentBox.x + contentX + offsetX;
        const sheetY = page.contentBox.y + contentY;
        const hit = findTableInteractionAt(
          tableInteractionIndex(layout),
          sheetX,
          sheetY,
          layout,
          offsetX,
          pageIndex
        );
        if (hit?.kind !== 'insertRow' || hit.tableId !== tableId) return null;
        return clientPoint(editor, layout, pages, pageIndex, contentX, contentY);
      }
      const column = options.column ?? 0;
      const left = table.columnEdges[column] ?? 0;
      const right = table.columnEdges[column + 1] ?? table.box.width;
      const contentX = table.box.x + (left + right) / 2;
      const contentY = table.box.y - 14;
      const offsetX = pageOffsetXFor(layout, pageIndex);
      const page = layout.pages[pageIndex]!;
      const sheetX = page.contentBox.x + contentX + offsetX;
      const sheetY = page.contentBox.y + contentY;
      const hit = findTableInteractionAt(
        tableInteractionIndex(layout),
        sheetX,
        sheetY,
        layout,
        offsetX,
        pageIndex
      );
      if (hit?.kind !== 'insertColumn' || hit.tableId !== tableId) return null;
      return clientPoint(editor, layout, pages, pageIndex, contentX, contentY);
    },
    cellCenterPoint(tableMarker, row, column) {
      const editor = getEditor();
      const currentSurface = surface(editor);
      const layout = currentSurface?.layout();
      const part = documentPart(editor);
      const pages = document.querySelector<HTMLElement>('.docx-pages');
      if (!layout || !part || !pages) return null;
      const tableId = tableByMarker(part, tableMarker).id;
      const table = findTableFragment(layout, tableId);
      if (!table) return null;
      const rowRec = table.rows[row];
      const cell = rowRec?.cells.find((candidate) => candidate.gridColumn === column);
      if (!rowRec || !cell) return null;
      const pageIndex = pageIndexForTable(layout, tableId);
      const x = table.box.x + cell.box.x + cell.box.width / 2;
      const y = rowRec.box.y + cell.box.y + cell.box.height / 2;
      return clientPoint(editor, layout, pages, pageIndex, x, y);
    },
    clickParagraph(needle) {
      if (!this.scrollToParagraph(needle)) return false;
      const fragment = [...document.querySelectorAll('.docx-paragraph-fragment')].find((node) =>
        node.textContent?.includes(needle)
      );
      if (!(fragment instanceof HTMLElement)) return false;
      fragment.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
      );
      fragment.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 })
      );
      fragment.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      );
      return true;
    },
  };
}
