// Table interaction furniture for the paginated surface.
//
// A contenteditable=false sibling layer over painted pages. Geometry and targets come only
// from semantic layout records — never from painted table DOM.

import type { ExecResult } from '../contracts/editor.ts';
import type { SemanticLayout, SemanticSelection } from '@docx-editor.dev/core-contract/layout';
import type { OoxmlElement } from '@docx-editor.dev/core-contract/store';
import { readEditableTableTopology } from '../store/store/tree-op-table-topology.ts';
import { wmlAttributeValue } from '../store/store/tree-op-table-shared.ts';
import { MIN_TABLE_COLUMN_WIDTH_TWIPS } from '../store/store/table-constraints.ts';
import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { BlockFragmentRecord, TableFragmentRecord } from '../layout/semantic-records.ts';
import type { CellSelection } from '../layout/semantic-cell-selection.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import { planTableCommand, type TableCommandPlan } from './table-command-plan.ts';
import { pageAtY } from '../layout/semantic-hit-test.ts';
import {
  findTableInteractionAt,
  resolveTableInteractionInsertHit,
  tableInteractionHitIdentity,
  tableInteractionIndex,
  tableInteractionTargetIdentity,
  type TableInteractionHit,
  type TableInteractionIndex,
} from '../layout/semantic-table-interaction.ts';
import type {
  TableColumnDividerResizeTarget,
  TableRightEdgeResizeTarget,
} from '@docx-editor.dev/core-contract/contracts/editor';
import {
  findTableOccurrence,
  tableColumnDividerResizeTargetFrom,
  tableColumnOccurrenceTargetFrom,
  tableRightEdgeResizeTargetFrom,
  tableRowOccurrenceTargetFrom,
  type TableOccurrenceRef,
} from '../layout/table-interaction-targets.ts';
import type { TableInteractionLabelKey } from './table-chrome.ts';

const HOVER_REVEAL_MS = 150;
const HOVER_HIDE_MS = 120;
const PT_TO_TWIPS = 20;

/** i18n keys for core-owned table insertion furniture — canonical in table-chrome.ts. @public */
export type { TableInteractionLabelKey } from './table-chrome.ts';

export interface SurfaceTableInteractionInput {
  readonly layout: SemanticLayout;
  readonly storeRevision: number;
  readonly selection: SemanticSelection;
  readonly cellSelection: CellSelection | null;
  readonly editingMode: SurfaceEditingMode;
  readonly themeColors: readonly import('../binding/document-theme.ts').DocumentThemeColorEntry[];
}

export interface SurfaceTableInteractionHost {
  readonly pagesLayer: HTMLElement;
  readonly furnitureLayer: HTMLElement;
  scale(): number;
  pageOffsetX(pageIndex: number): number;
  read(): SurfaceTableInteractionInput;
  session(): TreeDocxSession;
  applyTableCommandPlan(plan: TableCommandPlan): ExecResult;
  label(key: TableInteractionLabelKey): string;
}

export interface SurfaceTableInteraction {
  update(): void;
  /** Repaint visible insertion furniture labels from the current resolver. */
  refreshLabels(): void;
  destroy(): void;
}

interface DragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startEdgePt: number;
  readonly leftTwips: number;
  readonly rightTwips: number;
  readonly tableWidthTwips: number;
  readonly target: Extract<TableInteractionHit, { kind: 'columnDivider' | 'rightEdge' }>;
  readonly ref: TableOccurrenceRef;
  readonly resizeTarget: TableColumnDividerResizeTarget | TableRightEdgeResizeTarget;
  readonly captureElement: HTMLElement;
  readonly rightEdge: boolean;
  cancelled: boolean;
}

interface LastPointerSheet {
  readonly x: number;
  readonly y: number;
  readonly pageIndex: number;
}

function gridWidthTwips(element: OoxmlElement): number {
  const raw = wmlAttributeValue(element, 'w');
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function clientToSheet(
  host: SurfaceTableInteractionHost,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = host.pagesLayer.getBoundingClientRect();
  const scale = host.scale();
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale,
  };
}

function plannerMode(input: SurfaceTableInteractionInput): { editable: boolean; viewing: boolean } {
  const viewing = input.editingMode === 'view';
  return { editable: !viewing, viewing };
}

function findTableOnPage(
  layout: SemanticLayout,
  tableId: string,
  pageIndex: number
): TableFragmentRecord | null {
  const visit = (blocks: readonly BlockFragmentRecord[]): TableFragmentRecord | null => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue;
      if (block.tableId === tableId) return block;
      for (const row of block.rows) {
        for (const cell of row.cells) {
          const nested = visit(cell.blocks);
          if (nested) return nested;
        }
      }
    }
    return null;
  };
  return visit(layout.pages[pageIndex]?.fragments ?? []);
}

function occurrenceRef(
  layout: SemanticLayout,
  hit: Extract<
    TableInteractionHit,
    { kind: 'columnDivider' | 'rightEdge' | 'insertRow' | 'insertColumn' }
  >
): TableOccurrenceRef | null {
  if (hit.kind === 'insertColumn') {
    return findTableOccurrence(layout, hit.tableId, hit.rowId, hit.isHeaderRepeat);
  }
  if ('rowId' in hit) {
    return findTableOccurrence(layout, hit.tableId, hit.rowId, hit.isHeaderRepeat);
  }
  return null;
}

export function createSurfaceTableInteraction(
  host: SurfaceTableInteractionHost
): SurfaceTableInteraction {
  const layer = host.furnitureLayer;
  layer.className = 'docx-table-furniture';
  layer.setAttribute('contenteditable', 'false');
  layer.style.position = 'absolute';
  layer.style.left = '0';
  layer.style.top = '0';
  layer.style.pointerEvents = 'none';

  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverHit: TableInteractionHit | null = null;
  let index: TableInteractionIndex | null = null;
  let indexedLayoutRevision: number | null = null;
  let indexedStoreRevision: number | null = null;
  let drag: DragState | null = null;
  let overInsertControl = false;
  let lastMoveClientX = 0;
  let lastPointerSheet: LastPointerSheet | null = null;
  let insertButton: HTMLButtonElement | null = null;
  let insertHit: TableInteractionHit | null = null;

  function isInsertButton(node: Node): node is HTMLButtonElement {
    return (
      node instanceof HTMLButtonElement &&
      (node.classList.contains('docx-table-insert-row') ||
        node.classList.contains('docx-table-insert-column'))
    );
  }

  function focusedInsertButton(): HTMLButtonElement | null {
    const active = document.activeElement;
    if (
      active !== null &&
      isInsertButton(active) &&
      active.closest('.docx-table-furniture') === layer
    ) {
      return active;
    }
    return null;
  }

  function removeExtraInsertButtons(keep: HTMLButtonElement | null): void {
    for (const child of [...layer.children]) {
      if (isInsertButton(child) && child !== keep) child.remove();
    }
  }

  function resetInsertState(): void {
    insertButton = null;
    insertHit = null;
  }

  function clearTimers(): void {
    if (revealTimer !== null) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function clearFurniture(): void {
    for (const child of [...layer.children]) {
      if (!isInsertButton(child)) child.remove();
    }
    const focused = focusedInsertButton();
    if (!focused) {
      removeExtraInsertButtons(null);
      resetInsertState();
      return;
    }
    insertButton = focused;
    removeExtraInsertButtons(focused);
  }

  function clearAllFurniture(restorePagesFocus: boolean): void {
    const button = insertButton ?? focusedInsertButton();
    const wasFocused = button !== null && document.activeElement === button;
    resetInsertState();
    layer.replaceChildren();
    if (restorePagesFocus && wasFocused) host.pagesLayer.focus({ preventScroll: true });
  }

  function clearNonInsertFurniture(): void {
    for (const child of [...layer.children]) {
      if (!isInsertButton(child)) child.remove();
    }
  }

  function cssPoint(
    pageIndex: number,
    contentX: number,
    contentY: number
  ): { left: number; top: number } {
    const input = host.read();
    const page = input.layout.pages[pageIndex];
    if (!page) return { left: 0, top: 0 };
    const scale = host.scale();
    const offsetX = host.pageOffsetX(pageIndex);
    return {
      left: (page.contentBox.x + contentX + offsetX) * scale,
      top: (page.contentBox.y + contentY) * scale,
    };
  }

  function paintPreview(
    edgePt: number,
    hit: Extract<TableInteractionHit, { kind: 'columnDivider' | 'rightEdge' }>
  ): void {
    const input = host.read();
    const table = findTableOnPage(input.layout, hit.tableId, hit.pageIndex);
    if (!table) return;
    const preview = document.createElement('div');
    preview.className = 'docx-table-resize-preview';
    preview.style.position = 'absolute';
    preview.style.pointerEvents = 'none';
    const pos = cssPoint(hit.pageIndex, table.box.x + edgePt, table.box.y);
    preview.style.left = `${pos.left}px`;
    preview.style.top = `${pos.top}px`;
    preview.style.width = '2px';
    preview.style.height = `${table.box.height * host.scale()}px`;
    layer.append(preview);
  }

  function createInsertButtonShell(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '+';
    button.style.position = 'absolute';
    button.style.pointerEvents = 'auto';
    return button;
  }

  function onInsertClick(event: Event): void {
    guardInsertPointer(event);
    const hit = insertHit;
    if (!hit) return;
    const input = host.read();
    if (hit.kind === 'insertRow') commitInsertRow(hit, input);
    else if (hit.kind === 'insertColumn') commitInsertColumn(hit, input);
  }

  function onInsertBlur(): void {
    queueMicrotask(() => {
      if (!insertButton || document.activeElement === insertButton) return;
      if (overInsertControl) return;
      if (hoverHit?.kind === 'insertRow' || hoverHit?.kind === 'insertColumn') return;
      insertButton.remove();
      resetInsertState();
    });
  }

  function ensureInsertButton(): HTMLButtonElement {
    if (insertButton && layer.contains(insertButton)) return insertButton;
    const focused = focusedInsertButton();
    if (focused) {
      insertButton = focused;
      return focused;
    }
    const button = createInsertButtonShell();
    button.addEventListener('pointerenter', () => {
      overInsertControl = true;
      clearTimers();
    });
    button.addEventListener('pointerleave', () => {
      overInsertControl = false;
    });
    button.addEventListener('pointerdown', guardInsertPointer);
    button.addEventListener('mousedown', guardInsertPointer);
    button.addEventListener('click', onInsertClick);
    button.addEventListener('blur', onInsertBlur);
    insertButton = button;
    return button;
  }

  function paintInsertControl(
    hit: Extract<TableInteractionHit, { kind: 'insertRow' | 'insertColumn' }>,
    input: SurfaceTableInteractionInput
  ): void {
    const table = findTableOnPage(input.layout, hit.tableId, hit.pageIndex);
    if (!table) return;
    const button = ensureInsertButton();
    removeExtraInsertButtons(button);
    insertHit = hit;
    button.dataset.tableId = hit.tableId;

    if (hit.kind === 'insertRow') {
      const row = table.rows.find((candidate) => candidate.id === hit.rowId);
      if (!row) return;
      button.dataset.rowId = hit.rowId;
      delete button.dataset.gridColumnId;
      button.className = 'docx-table-insert-row';
      button.setAttribute('aria-label', host.label('table.insertRowBelow'));
      const rowMidY = row.box.y + row.box.height / 2;
      const pos = cssPoint(hit.pageIndex, table.box.x - 14, rowMidY);
      button.style.left = `${pos.left}px`;
      button.style.top = `${pos.top - 8}px`;
    } else {
      const cell = table.rows[0]?.cells.find(
        (candidate) => candidate.gridColumnId === hit.gridColumnId
      );
      if (!cell) return;
      button.dataset.gridColumnId = hit.gridColumnId;
      delete button.dataset.rowId;
      const left = table.columnEdges[cell.gridColumn] ?? 0;
      const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
      button.className = 'docx-table-insert-column';
      button.setAttribute('aria-label', host.label('table.insertColumnRight'));
      const pos = cssPoint(hit.pageIndex, table.box.x + (left + right) / 2 - 8, table.box.y - 14);
      button.style.left = `${pos.left}px`;
      button.style.top = `${pos.top}px`;
    }
    if (!layer.contains(button)) layer.append(button);
  }

  function guardInsertPointer(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function paintHover(hit: TableInteractionHit, input: SurfaceTableInteractionInput): void {
    clearNonInsertFurniture();
    removeExtraInsertButtons(insertButton ?? focusedInsertButton());
    if (drag || input.editingMode === 'view') return;

    if ((hit.kind === 'columnDivider' || hit.kind === 'rightEdge') && !hit.isHeaderRepeat) {
      const table = findTableOnPage(input.layout, hit.tableId, hit.pageIndex);
      if (!table) return;
      const handle = document.createElement('div');
      handle.className =
        hit.kind === 'rightEdge'
          ? 'docx-table-edge-handle-right layout-table-edge-handle-right'
          : 'docx-table-divider-handle layout-table-resize-handle';
      handle.style.position = 'absolute';
      handle.style.pointerEvents = 'auto';
      handle.style.cursor = 'col-resize';
      const pos = cssPoint(hit.pageIndex, table.box.x + hit.edgeX, table.box.y);
      handle.style.left = `${pos.left - 3}px`;
      handle.style.top = `${pos.top}px`;
      handle.style.width = '6px';
      handle.style.height = `${table.box.height * host.scale()}px`;
      handle.addEventListener('pointerdown', onDividerPointerDown);
      layer.append(handle);
    }

    if (hit.kind === 'insertRow' && !hit.isHeaderRepeat) {
      paintInsertControl(hit, input);
    }

    if (hit.kind === 'insertColumn' && !hit.isHeaderRepeat) {
      paintInsertControl(hit, input);
    }
  }

  function commitInsertRow(
    hit: Extract<TableInteractionHit, { kind: 'insertRow' }>,
    input: SurfaceTableInteractionInput
  ): void {
    const ref = occurrenceRef(input.layout, hit);
    if (!ref) return;
    const mode = plannerMode(input);
    const plan = planTableCommand({
      command: {
        type: 'insertRow',
        where: 'below',
        target: tableRowOccurrenceTargetFrom(hit.sourceRevision, ref),
      },
      part: host.session().part(),
      layout: input.layout,
      storeRevision: input.storeRevision,
      selection: input.selection,
      cellSelection: input.cellSelection,
      themeColors: input.themeColors,
      ...mode,
    });
    host.applyTableCommandPlan(plan);
  }

  function commitInsertColumn(
    hit: Extract<TableInteractionHit, { kind: 'insertColumn' }>,
    input: SurfaceTableInteractionInput
  ): void {
    const ref = occurrenceRef(input.layout, hit);
    if (!ref) return;
    const cell = ref.row.cells.find((candidate) => candidate.gridColumnId === hit.gridColumnId);
    if (!cell) return;
    const target = tableColumnOccurrenceTargetFrom(hit.sourceRevision, ref, cell);
    if (!target) return;
    const mode = plannerMode(input);
    const plan = planTableCommand({
      command: { type: 'insertColumn', where: 'right', target },
      part: host.session().part(),
      layout: input.layout,
      storeRevision: input.storeRevision,
      selection: input.selection,
      cellSelection: input.cellSelection,
      themeColors: input.themeColors,
      ...mode,
    });
    host.applyTableCommandPlan(plan);
  }

  function onDividerPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const input = host.read();
    if (input.editingMode === 'view') return;
    if (!hoverHit || (hoverHit.kind !== 'columnDivider' && hoverHit.kind !== 'rightEdge')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = hoverHit;
    const ref = occurrenceRef(input.layout, target);
    if (!ref) return;
    const topo = readEditableTableTopology(host.session().part().root, target.tableId);
    if (!topo.ok || topo.topology.hasMerge) return;

    let leftTwips = 0;
    let rightTwips = 0;
    const tableWidthTwips = topo.topology.gridColumns.reduce(
      (sum, col) => sum + gridWidthTwips(col),
      0
    );

    let resizeTarget: TableColumnDividerResizeTarget | TableRightEdgeResizeTarget;
    if (target.kind === 'columnDivider') {
      const leftCol = topo.topology.gridColumns.find((col) => col.id === target.leftGridColumnId);
      const rightCol = topo.topology.gridColumns.find((col) => col.id === target.rightGridColumnId);
      if (!leftCol || !rightCol) return;
      leftTwips = gridWidthTwips(leftCol);
      rightTwips = gridWidthTwips(rightCol);
      resizeTarget = tableColumnDividerResizeTargetFrom(
        target.sourceRevision,
        ref,
        target.leftGridColumnId,
        target.rightGridColumnId
      );
    } else {
      const lastCol = topo.topology.gridColumns.find((col) => col.id === target.gridColumnId);
      if (!lastCol) return;
      leftTwips = gridWidthTwips(lastCol);
      rightTwips = 0;
      resizeTarget = tableRightEdgeResizeTargetFrom(
        target.sourceRevision,
        ref,
        target.gridColumnId
      );
    }

    const captureElement = event.currentTarget as HTMLElement;
    captureElement.setPointerCapture(event.pointerId);
    lastMoveClientX = event.clientX;

    drag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startEdgePt: target.edgeX,
      leftTwips,
      rightTwips,
      tableWidthTwips,
      target,
      ref,
      resizeTarget,
      captureElement,
      rightEdge: target.kind === 'rightEdge',
      cancelled: false,
    };
    for (const child of [...layer.children]) {
      if (child !== captureElement) child.remove();
    }
    paintPreview(target.edgeX, target);
  }

  function cancelDrag(): void {
    if (!drag) return;
    try {
      if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
        drag.captureElement.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // ignore release failures in test hosts
    }
    drag.cancelled = true;
    drag = null;
    clearFurniture();
    hoverHit = null;
  }

  function commitDrag(): void {
    if (!drag || drag.cancelled) {
      drag = null;
      clearFurniture();
      return;
    }
    const activeDrag = drag;
    drag = null;
    try {
      if (activeDrag.captureElement.hasPointerCapture(activeDrag.pointerId)) {
        activeDrag.captureElement.releasePointerCapture(activeDrag.pointerId);
      }
    } catch {
      // ignore release failures in test hosts
    }

    if (lastMoveClientX === activeDrag.startClientX) {
      clearFurniture();
      return;
    }

    const input = host.read();
    const mode = plannerMode(input);
    const movePt = (lastMoveClientX - activeDrag.startClientX) / host.scale();
    const moveTwips = Math.round(movePt * PT_TO_TWIPS);

    let plan: TableCommandPlan;
    if (activeDrag.rightEdge && activeDrag.target.kind === 'rightEdge') {
      const columnWidthTwips = Math.max(
        MIN_TABLE_COLUMN_WIDTH_TWIPS,
        activeDrag.leftTwips + moveTwips
      );
      const tableWidthTwips = Math.max(columnWidthTwips, activeDrag.tableWidthTwips + moveTwips);
      plan = planTableCommand({
        command: {
          type: 'commitTableRightEdgeResize',
          target: activeDrag.resizeTarget as TableRightEdgeResizeTarget,
          columnWidthTwips,
          tableWidthTwips,
        },
        part: host.session().part(),
        layout: input.layout,
        storeRevision: input.storeRevision,
        selection: input.selection,
        cellSelection: input.cellSelection,
        themeColors: input.themeColors,
        ...mode,
      });
    } else if (activeDrag.target.kind === 'columnDivider') {
      let leftTwips = activeDrag.leftTwips + moveTwips;
      let rightTwips = activeDrag.rightTwips - moveTwips;
      leftTwips = Math.max(MIN_TABLE_COLUMN_WIDTH_TWIPS, leftTwips);
      rightTwips = Math.max(MIN_TABLE_COLUMN_WIDTH_TWIPS, rightTwips);
      const sum = activeDrag.leftTwips + activeDrag.rightTwips;
      if (leftTwips + rightTwips !== sum) {
        if (leftTwips > sum - MIN_TABLE_COLUMN_WIDTH_TWIPS) {
          leftTwips = sum - MIN_TABLE_COLUMN_WIDTH_TWIPS;
          rightTwips = MIN_TABLE_COLUMN_WIDTH_TWIPS;
        } else {
          rightTwips = sum - leftTwips;
        }
      }
      plan = planTableCommand({
        command: {
          type: 'commitTableColumnDividerResize',
          target: activeDrag.resizeTarget as TableColumnDividerResizeTarget,
          leftWidthTwips: leftTwips,
          rightWidthTwips: rightTwips,
        },
        part: host.session().part(),
        layout: input.layout,
        storeRevision: input.storeRevision,
        selection: input.selection,
        cellSelection: input.cellSelection,
        themeColors: input.themeColors,
        ...mode,
      });
    } else {
      clearFurniture();
      return;
    }

    host.applyTableCommandPlan(plan);
    clearFurniture();
  }

  function hitAtLastPointer(input: SurfaceTableInteractionInput): TableInteractionHit | null {
    if (!index || !lastPointerSheet) return null;
    const pageOffsetX = host.pageOffsetX(lastPointerSheet.pageIndex);
    return findTableInteractionAt(
      index,
      lastPointerSheet.x,
      lastPointerSheet.y,
      input.layout,
      pageOffsetX,
      lastPointerSheet.pageIndex
    );
  }

  function refreshHoverAfterRelayout(input: SurfaceTableInteractionInput): void {
    if (!hoverHit || drag || input.editingMode === 'view') return;
    clearTimers();
    const hit = hitAtLastPointer(input);
    if (!hit || hit.kind === 'tableBody') {
      hoverHit = null;
      clearFurniture();
      return;
    }
    if (tableInteractionTargetIdentity(hit) !== tableInteractionTargetIdentity(hoverHit)) {
      hoverHit = null;
      clearFurniture();
      return;
    }
    hoverHit = hit;
    paintHover(hit, input);
  }

  function retireRetainedInsertButton(): void {
    const button = insertButton ?? focusedInsertButton();
    const wasFocused = button !== null && document.activeElement === button;
    resetInsertState();
    if (button && layer.contains(button)) button.remove();
    if (wasFocused) host.pagesLayer.focus({ preventScroll: true });
  }

  function refreshRetainedInsertAfterRelayout(input: SurfaceTableInteractionInput): void {
    if (drag || input.editingMode === 'view') return;
    const retained = insertButton ?? focusedInsertButton();
    if (!retained || !layer.contains(retained)) {
      if (insertHit) resetInsertState();
      return;
    }
    insertButton = retained;
    if (!insertHit || (insertHit.kind !== 'insertRow' && insertHit.kind !== 'insertColumn')) return;
    if (!index) {
      retireRetainedInsertButton();
      return;
    }

    const priorTarget = tableInteractionTargetIdentity(insertHit);
    const resolved = resolveTableInteractionInsertHit(index, insertHit);
    if (!resolved || tableInteractionTargetIdentity(resolved) !== priorTarget) {
      retireRetainedInsertButton();
      return;
    }
    insertHit = resolved;
    paintInsertControl(resolved, input);
  }

  function onPointerMove(event: PointerEvent): void {
    const input = host.read();
    if (drag && event.pointerId === drag.pointerId) {
      lastMoveClientX = event.clientX;
      const deltaPt = (event.clientX - drag.startClientX) / host.scale();
      for (const child of [...layer.children]) {
        if (child !== drag.captureElement) child.remove();
      }
      paintPreview(drag.startEdgePt + deltaPt, drag.target);
      return;
    }
    if (input.editingMode === 'view') {
      clearAllFurniture(false);
      return;
    }
    const sheet = clientToSheet(host, event.clientX, event.clientY);
    const pageIndex = pageAtY(input.layout, sheet.y);
    if (pageIndex >= 0) {
      lastPointerSheet = { x: sheet.x, y: sheet.y, pageIndex };
    }
    const pageOffsetX = pageIndex >= 0 ? host.pageOffsetX(pageIndex) : 0;
    const hit = index
      ? findTableInteractionAt(
          index,
          sheet.x,
          sheet.y,
          input.layout,
          pageOffsetX,
          pageIndex >= 0 ? pageIndex : undefined
        )
      : null;
    if (!hit || hit.kind === 'tableBody') {
      if (overInsertControl) return;
      if (!hideTimer && hoverHit) {
        hideTimer = setTimeout(() => {
          hideTimer = null;
          hoverHit = null;
          clearFurniture();
        }, HOVER_HIDE_MS);
      }
      return;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (hoverHit && tableInteractionHitIdentity(hit) === tableInteractionHitIdentity(hoverHit))
      return;
    if (hit.kind === 'insertRow' || hit.kind === 'insertColumn') {
      if (revealTimer) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      hoverHit = hit;
      paintHover(hit, input);
      return;
    }
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealTimer = null;
      hoverHit = hit;
      paintHover(hit, input);
    }, HOVER_REVEAL_MS);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (host.read().editingMode === 'view') {
      cancelDrag();
      return;
    }
    commitDrag();
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelDrag();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !drag) return;
    cancelDrag();
  }

  host.pagesLayer.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  host.pagesLayer.addEventListener('keydown', onKeyDown);

  return {
    update() {
      const input = host.read();
      const previousLayoutRevision = indexedLayoutRevision;
      const previousStoreRevision = indexedStoreRevision;
      index = tableInteractionIndex(input.layout);
      indexedLayoutRevision = input.layout.revision;
      indexedStoreRevision = input.storeRevision;
      if (input.editingMode === 'view') {
        cancelDrag();
        hoverHit = null;
        clearTimers();
        clearAllFurniture(true);
      } else if (
        previousLayoutRevision !== null &&
        (previousLayoutRevision !== input.layout.revision ||
          previousStoreRevision !== input.storeRevision)
      ) {
        if (hoverHit !== null) {
          refreshHoverAfterRelayout(input);
        }
        refreshRetainedInsertAfterRelayout(input);
      }
      layer.style.width = host.pagesLayer.style.width;
      layer.style.height = host.pagesLayer.style.height;
    },
    refreshLabels() {
      const input = host.read();
      if (input.editingMode === 'view') return;
      const retained = insertButton ?? focusedInsertButton();
      if (
        retained &&
        layer.contains(retained) &&
        insertHit &&
        (insertHit.kind === 'insertRow' || insertHit.kind === 'insertColumn')
      ) {
        paintInsertControl(insertHit, input);
        return;
      }
      if (hoverHit && (hoverHit.kind === 'insertRow' || hoverHit.kind === 'insertColumn')) {
        paintInsertControl(hoverHit, input);
      }
    },
    destroy() {
      clearTimers();
      cancelDrag();
      resetInsertState();
      clearFurniture();
      host.pagesLayer.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      host.pagesLayer.removeEventListener('keydown', onKeyDown);
      layer.remove();
    },
  };
}
