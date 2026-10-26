// The handle at a table's top-left corner that selects the whole table, as in Word.
//
// Its own sheet, not the table furniture's: that layer is cleared on every hover change, and
// this handle has to outlive those while the caret is in the table.

import type { SemanticLayout, SemanticSelection } from '@docx-editor.dev/core/layout';
import type { TableInteractionLabelKey } from '@docx-editor.dev/core/contracts/editor';
import { caretAt } from '../layout/semantic-interaction.ts';
import {
  tableContextAt,
  wholeTableCellSelection,
  type CellSelection,
} from '../layout/semantic-cell-selection.ts';
import { pageAtY } from '../layout/semantic-hit-test.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import {
  findTableInteractionAt,
  tableInteractionIndex,
} from '../layout/semantic-table-interaction.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import { hostTimers } from './host-realm.ts';
import type { SurfaceHostListeners } from './surface-host-listeners.ts';
import { partNameOf } from './surface-table-story.ts';

const HOVER_HIDE_MS = 120;
/** Points from the table's top-left corner to the handle's, clear of the insert buttons. */
const HANDLE_OFFSET_PT = 18;

export interface SurfaceTableSelectHandleHost {
  readonly pagesLayer: HTMLElement;
  readonly layer: HTMLElement;
  readonly listeners: SurfaceHostListeners;
  scale(): number;
  pageOffsetX(pageIndex: number): number;
  read(): {
    readonly layout: SemanticLayout;
    readonly selection: SemanticSelection;
    readonly editingMode: SurfaceEditingMode;
  };
  label(key: TableInteractionLabelKey): string;
  setCellSelection(cells: CellSelection): void;
}

export interface SurfaceTableSelectHandle {
  update(): void;
  destroy(): void;
}

interface Target {
  readonly tableId: string;
  readonly pageIndex: number;
}

interface OutermostTable {
  readonly table: TableFragmentRecord;
  readonly origin: LayoutBox;
}

function containsTable(block: TableFragmentRecord, tableId: string): boolean {
  if (block.tableId === tableId) return true;
  return block.rows.some((row) =>
    row.cells.some((cell) =>
      cell.blocks.some((child) => child.kind === 'table' && containsTable(child, tableId))
    )
  );
}

/** The top-level table on a page that holds `tableId`, itself or nested, with its story's origin. */
function outermostTableOnPage(
  layout: SemanticLayout,
  tableId: string,
  pageIndex: number
): OutermostTable | null {
  const page = layout.pages[pageIndex];
  if (!page) return null;
  const find = (blocks: readonly BlockFragmentRecord[]): TableFragmentRecord | null =>
    blocks.find(
      (block): block is TableFragmentRecord =>
        block.kind === 'table' && containsTable(block, tableId)
    ) ?? null;
  const inBody = find(page.fragments);
  if (inBody) return { table: inBody, origin: page.contentBox };
  for (const story of [page.header, page.footer]) {
    const found = story ? find(story.fragments) : null;
    if (found && story) return { table: found, origin: story.box };
  }
  return null;
}

export function createSurfaceTableSelectHandle(
  host: SurfaceTableSelectHandleHost
): SurfaceTableSelectHandle {
  const { layer } = host;
  const timers = hostTimers(() => layer);
  let hovered: Target | null = null;
  let overHandle = false;
  let hideTimer: number | null = null;
  let shownTableId: string | null = null;

  const button = layer.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'docx-table-select-handle';
  button.textContent = '✥';
  button.style.position = 'absolute';
  button.style.pointerEvents = 'auto';
  const guard = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.addEventListener('pointerdown', guard);
  button.addEventListener('mousedown', guard);
  button.addEventListener('click', (event) => {
    guard(event);
    const cells = shownTableId ? wholeTableCellSelection(host.read().layout, shownTableId) : null;
    if (!cells) return;
    host.setCellSelection(cells);
    host.pagesLayer.focus({ preventScroll: true });
  });
  button.addEventListener('pointerenter', () => {
    overHandle = true;
    clearHideTimer();
  });
  button.addEventListener('pointerleave', () => {
    overHandle = false;
  });

  function clearHideTimer(): void {
    if (hideTimer === null) return;
    timers.clearTimeout(hideTimer);
    hideTimer = null;
  }

  function caretTarget(layout: SemanticLayout, selection: SemanticSelection): Target | null {
    const tableId = tableContextAt(layout, selection.head.paragraphId)?.tableId;
    const pageIndex =
      tableId === undefined ? undefined : caretAt(layout, selection.head)?.pageIndex;
    return tableId === undefined || pageIndex === undefined ? null : { tableId, pageIndex };
  }

  function update(): void {
    const { layout, selection, editingMode } = host.read();
    const caretParagraphId = selection.head.paragraphId;
    const target =
      editingMode === 'view'
        ? null
        : hovered && partNameOf(hovered.tableId) === partNameOf(caretParagraphId)
          ? hovered
          : caretTarget(layout, selection);
    const found = target ? outermostTableOnPage(layout, target.tableId, target.pageIndex) : null;
    if (!target || !found) {
      shownTableId = null;
      button.remove();
      return;
    }
    const { table, origin } = found;
    const scale = host.scale();
    const offsetX = host.pageOffsetX(target.pageIndex);
    shownTableId = table.tableId;
    button.dataset.tableId = table.tableId;
    button.setAttribute('aria-label', host.label('table.selectTable'));
    button.title = host.label('table.selectTable');
    button.style.left = `${(origin.x + table.box.x - HANDLE_OFFSET_PT + offsetX) * scale}px`;
    button.style.top = `${(origin.y + table.box.y - HANDLE_OFFSET_PT) * scale}px`;
    if (button.parentNode !== layer) layer.append(button);
  }

  function onPointerMove(event: PointerEvent): void {
    if (overHandle) return;
    const { layout } = host.read();
    const rect = host.pagesLayer.getBoundingClientRect();
    const scale = host.scale();
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    const pageIndex = pageAtY(layout, y);
    const hit =
      pageIndex >= 0
        ? findTableInteractionAt(
            tableInteractionIndex(layout),
            x,
            y,
            layout,
            host.pageOffsetX(pageIndex),
            pageIndex
          )
        : null;
    if (hit) {
      clearHideTimer();
      if (hovered?.tableId === hit.tableId && hovered.pageIndex === hit.pageIndex) return;
      hovered = { tableId: hit.tableId, pageIndex: hit.pageIndex };
      update();
      return;
    }
    if (!hovered || hideTimer !== null) return;
    timers.migrate();
    hideTimer = timers.setTimeout(() => {
      hideTimer = null;
      hovered = null;
      update();
    }, HOVER_HIDE_MS);
  }

  const unlisten = host.listeners.onDocument('pointermove', onPointerMove);

  return {
    update,
    destroy() {
      clearHideTimer();
      unlisten();
      layer.remove();
    },
  };
}
