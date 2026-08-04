// Task 12 — nested table editing acceptance on the real React paginated editor.
//
// UI locators trigger controls; canonical IDs, topology, fingerprint, and semantic
// digest assert authored persistence. Visual DOM is never the authority.

import { expect, test, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertAllInnerCellsMatchPreFormat,
  assertSelectionIdPartition,
  assertTableFormattingOracle,
  cellIdsInSelectionRectangle,
  detailedTableSnapshot,
  detailedTopologyContentEqual,
  findInnerTable,
  outerTableIsolationEqual,
  outerTableIsolationFingerprint,
  readTableEditingPackage,
  readTableEditingReadback,
  saveReopenDigestDiff,
} from './fixtures/table-editing-assertions.ts';

const FIXTURE = 'table-editing-nested.docx';
const DEMO_URL = `http://localhost:5273/?e2e=1&fixture=${FIXTURE}`;
const SCROLLER = '.docx-editor__scroll-container';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCREENSHOTS = path.join(REPO_ROOT, 'screenshots');

declare global {
  interface Window {
    __DOCX_EDITOR_E2E__?: import('../examples/vite/src/test-harness/table-editing-e2e-hook.ts').DocxEditorE2EHook;
  }
}

async function e2eReadback(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.readback());
}

async function e2eFingerprint(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.fingerprint());
}

async function e2eSaveBytes(page: Page) {
  return page.evaluate(async () => {
    const bytes = await window.__DOCX_EDITOR_E2E__!.saveBytes();
    return bytes ? Array.from(bytes) : null;
  });
}

async function e2eSaveAndReopen(page: Page) {
  return page.evaluate(async () => window.__DOCX_EDITOR_E2E__!.saveAndReopen());
}

async function e2eCan(page: Page, command: { type: string; where?: string }) {
  return page.evaluate((cmd) => window.__DOCX_EDITOR_E2E__!.can(cmd as never), command);
}

async function e2eGetZoom(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.getZoom());
}

async function e2eGetRenderScale(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.getRenderScale());
}

async function e2eRemountAtZoom(page: Page, zoom: number) {
  return page.evaluate(async (level) => window.__DOCX_EDITOR_E2E__!.remountAtZoom(level), zoom);
}

async function e2eGetSelectedTable(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.getSelectedTable());
}

async function e2eGetCellSelection(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.getCellSelection());
}

async function e2eDetailedTopology(page: Page, marker: 'inner' | 'outer' | 'merged' | 'tall') {
  return page.evaluate((tableMarker) => window.__DOCX_EDITOR_E2E__!.detailedTopology(tableMarker), marker);
}

async function e2eCanUndo(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.canUndo());
}

async function e2eCanRedo(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.canRedo());
}

async function waitForHook(page: Page) {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__DOCX_EDITOR_E2E__?.ready());
  await page.waitForSelector('.docx-page', { timeout: 30_000 });
}

async function settle(page: Page) {
  await page
    .locator(SCROLLER)
    .first()
    .evaluate((el) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true })));
  await page.waitForTimeout(250);
}

async function capture(page: Page, name: string) {
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`), fullPage: false });
}

async function focusInnerCell(
  page: Page,
  expected?: { rowCount: number; columnCount: number }
) {
  const scrolled = await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.scrollToParagraph('INNER-NW'));
  expect(scrolled).toBe(true);
  await settle(page);
  const cell = page.locator('.docx-paragraph-fragment').filter({ hasText: 'INNER-NW' }).first();
  await expect(cell).toBeVisible();
  await cell.click();
  await settle(page);
  const selected = await e2eGetSelectedTable(page);
  expect(selected?.rowCount).toBe(expected?.rowCount ?? 2);
  expect(selected?.columnCount).toBe(expected?.columnCount ?? 2);
}

async function focusParagraph(page: Page, needle: string) {
  const scrolled = await page.evaluate(
    (text) => window.__DOCX_EDITOR_E2E__!.scrollToParagraph(text),
    needle
  );
  expect(scrolled).toBe(true);
  await settle(page);
  const fragment = page.locator('.docx-paragraph-fragment').filter({ hasText: needle }).first();
  await expect(fragment).toBeVisible();
  await fragment.click();
  await settle(page);
}

async function hoverEdge(
  page: Page,
  kind: 'divider' | 'right-edge' | 'insert-row' | 'insert-column',
  options?: { dividerIndex?: number; row?: number; column?: number }
) {
  const point = await page.evaluate(
    ([edgeKind, edgeOptions]) =>
      window.__DOCX_EDITOR_E2E__!.tableEdgePoint('inner', edgeKind, edgeOptions),
    [kind, options ?? {}] as const
  );
  expect(point).not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  if (kind === 'insert-row' || kind === 'insert-column') {
    const selector =
      kind === 'insert-row' ? '.docx-table-insert-row' : '.docx-table-insert-column';
    await expect(page.locator(selector).first()).toBeVisible();
  } else {
    await page.waitForTimeout(220);
    await page.mouse.move(point!.x, point!.y);
    await page.waitForTimeout(40);
  }
  return point!;
}

async function dragFromHandle(
  page: Page,
  selector: string,
  deltaX: number,
  deltaY = 0
) {
  const handle = page.locator(selector).first();
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2 + deltaY);
  await page.mouse.up();
  await settle(page);
}

async function dragCellRectangle(
  page: Page,
  from: [number, number],
  to: [number, number],
  options?: { startParagraphId?: string; endParagraphId?: string; startText?: string }
) {
  let startX: number;
  let startY: number;
  if (options?.startParagraphId) {
    const startCell = page.locator(`[data-paragraph-id="${options.startParagraphId}"]`).first();
    const startBox = await startCell.boundingBox();
    expect(startBox).not.toBeNull();
    startX = startBox!.x + startBox!.width / 2;
    startY = startBox!.y + startBox!.height / 2;
  } else if (options?.startText) {
    const startCell = page.locator('.docx-paragraph-fragment').filter({ hasText: options.startText }).first();
    const startBox = await startCell.boundingBox();
    expect(startBox).not.toBeNull();
    startX = startBox!.x + startBox!.width / 2;
    startY = startBox!.y + startBox!.height / 2;
  } else {
    const start = await page.evaluate(
      ([row, column]) => window.__DOCX_EDITOR_E2E__!.cellCenterPoint('inner', row, column),
      from
    );
    expect(start).not.toBeNull();
    startX = start!.x;
    startY = start!.y;
  }

  let endX: number;
  let endY: number;
  if (options?.endParagraphId) {
    const endCell = page.locator(`[data-paragraph-id="${options.endParagraphId}"]`).first();
    const endBox = await endCell.boundingBox();
    expect(endBox).not.toBeNull();
    endX = endBox!.x + endBox!.width / 2;
    endY = endBox!.y + endBox!.height / 2;
  } else {
    const end = await page.evaluate(
      ([row, column]) => window.__DOCX_EDITOR_E2E__!.cellCenterPoint('inner', row, column),
      to
    );
    expect(end).not.toBeNull();
    endX = end!.x;
    endY = end!.y;
  }

  await page.locator('.docx-pages').first().scrollIntoViewIfNeeded();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 16 });
  await page.mouse.up();
  await settle(page);
}

async function pointerClickVerifiedControl(
  page: Page,
  selector: string,
  expectedTableId: string
): Promise<void> {
  const control = page.locator(selector).first();
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const hit = await page.evaluate(
    ([px, py, tableId]) => {
      const el = document.elementFromPoint(px, py);
      if (!(el instanceof Element)) return { ok: false, reason: 'no element at point' };
      const furniture = el.closest('[data-table-id]');
      if (!(furniture instanceof HTMLElement)) return { ok: false, reason: 'no furniture at point' };
      const hitTableId = furniture.getAttribute('data-table-id');
      if (hitTableId !== tableId) {
        return { ok: false, reason: `hit ${hitTableId ?? 'null'} not ${tableId}` };
      }
      return { ok: true, tag: furniture.className };
    },
    [x, y, expectedTableId] as const
  );
  expect(hit.ok, hit.ok ? '' : hit.reason).toBe(true);
  await page.mouse.click(x, y);
  await settle(page);
}

async function clickInsertRowFurniture(
  page: Page,
  expectedTableId: string
): Promise<{ rowId: string }> {
  const selector = `.docx-table-insert-row[data-table-id="${expectedTableId}"]`;
  const control = page.locator(selector).first();
  await expect(control).toBeVisible();
  const rowId = await control.getAttribute('data-row-id');
  expect(rowId).toBeTruthy();
  await pointerClickVerifiedControl(page, selector, expectedTableId);
  return { rowId: rowId! };
}

async function clickInsertColumnFurniture(
  page: Page,
  expectedTableId: string,
  insertPoint: { x: number; y: number }
): Promise<{ gridColumnId: string }> {
  let clicked = false;
  let gridColumnId: string | null = null;
  const selector = `.docx-table-insert-column[data-table-id="${expectedTableId}"]`;
  for (const deltaY of [0, -4, -8, 4, 8, -12, 12, -16]) {
    await page.mouse.move(insertPoint.x, insertPoint.y + deltaY);
    const control = page.locator(selector).first();
    try {
      await expect(control).toBeVisible({ timeout: 150 });
    } catch {
      continue;
    }
    gridColumnId = await control.getAttribute('data-grid-column-id');
    if (!gridColumnId) continue;
    try {
      await pointerClickVerifiedControl(page, selector, expectedTableId);
      clicked = true;
      break;
    } catch {
      // Y-scan continues until browser hit-testing lands on the inner control.
    }
  }
  expect(clicked).toBe(true);
  expect(gridColumnId).toBeTruthy();
  return { gridColumnId: gridColumnId! };
}

async function undoViaToolbar(page: Page) {
  const undo = page.locator('[data-slot="history.undo"]').first();
  await expect(undo).toBeEnabled();
  await undo.click();
  await settle(page);
}

async function redoViaKeyboard(page: Page) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
  await settle(page);
}

const BORDER_STYLE_INDEX: Record<string, number> = {
  single: 0,
  dashed: 1,
  dotted: 2,
  double: 3,
  triple: 4,
  thick: 5,
};

const BORDER_WIDTH_INDEX: Record<string, number> = {
  '4': 0,
  '8': 1,
  '12': 2,
  '16': 3,
  '24': 4,
};

async function pickToolbarOption(page: Page, slot: string, value: string) {
  const root = page.locator(`[data-slot="${slot}"]`).first();
  await root.locator('button').first().click();
  const byValue = root.locator(`[data-value="${value}"]`).first();
  if ((await byValue.count()) > 0) {
    await byValue.click();
  } else if (slot === 'table.borderStyle') {
    const index = BORDER_STYLE_INDEX[value];
    if (index === undefined) throw new Error(`unknown border style: ${value}`);
    await root.locator('[role="menuitemradio"]').nth(index).click();
  } else if (slot === 'table.borderWidth') {
    const index = BORDER_WIDTH_INDEX[value];
    if (index === undefined) throw new Error(`unknown border width: ${value}`);
    await root.locator('[role="menuitemradio"]').nth(index).click();
  } else {
    throw new Error(`cannot pick ${slot}=${value}`);
  }
  await settle(page);
}

test.describe('nested table editing acceptance', () => {
  test.beforeAll(() => {
    const fixturePath = path.join(REPO_ROOT, 'e2e/fixtures', FIXTURE);
    readFileSync(fixturePath);
  });

  test('edits the innermost nested table through furniture, toolbar, context menu, undo, zoom, and save/reopen', async ({
    page,
  }) => {
    await waitForHook(page);
    const loadedSaveRaw = await e2eSaveBytes(page);
    expect(loadedSaveRaw).not.toBeNull();
    const loadedPart = readTableEditingPackage(Uint8Array.from(loadedSaveRaw!));
    const outerIsolationBaseline = outerTableIsolationFingerprint(loadedPart);

    const baselineBytes = readFileSync(path.join(REPO_ROOT, 'e2e/fixtures', FIXTURE));
    const baseline = readTableEditingReadback(baselineBytes);
    const baselinePart = readTableEditingPackage(baselineBytes);
    const innerBaseline = detailedTableSnapshot(findInnerTable(baselinePart));
    const outerBaseline = baseline.outer!;
    const baselineFingerprint = baseline.fingerprint;

    await focusInnerCell(page);
    await capture(page, 'task12-01-inner-focused');

    const widthsBeforeDivider = innerBaseline.columnWidthsTwips;
    await hoverEdge(page, 'divider', { dividerIndex: 1, row: 0 });
    await dragFromHandle(page, '.docx-table-divider-handle', 18, 0);
    let readback = await e2eReadback(page);
    expect(readback?.inner?.columnWidthsTwips[0]).toBeGreaterThan(widthsBeforeDivider[0]!);
    expect(readback?.inner?.columnWidthsTwips[1]).toBeLessThan(widthsBeforeDivider[1]!);
    expect(readback?.inner?.columnWidthsTwips[0]! + readback?.inner?.columnWidthsTwips[1]!).toBe(
      widthsBeforeDivider[0]! + widthsBeforeDivider[1]!
    );
    await capture(page, 'task12-02-inner-divider-resized');

    const totalBeforeRight = readback!.inner!.columnWidthsTwips.reduce((sum, width) => sum + width, 0);
    await hoverEdge(page, 'right-edge', { row: 0 });
    await dragFromHandle(page, '.docx-table-edge-handle-right', 12, 0);
    readback = await e2eReadback(page);
    const totalAfterRight = readback!.inner!.columnWidthsTwips.reduce((sum, width) => sum + width, 0);
    expect(totalAfterRight).toBeGreaterThan(totalBeforeRight);
    await capture(page, 'task12-03-inner-right-edge-resized');

    const rowsBeforeRowInsert = readback!.inner!.rowCount;
    const innerIdBeforeRow = readback!.inner!.tableId;
    const innerDetailedBeforeRow = await e2eDetailedTopology(page, 'inner');
    expect(innerDetailedBeforeRow).not.toBeNull();
    await hoverEdge(page, 'insert-row', { row: 0 });
    await clickInsertRowFurniture(page, innerIdBeforeRow);
    readback = await e2eReadback(page);
    expect(readback?.inner?.rowCount).toBe(rowsBeforeRowInsert + 1);
    expect(readback?.inner?.tableId).toBe(innerIdBeforeRow);
    const innerDetailedAfterRow = await e2eDetailedTopology(page, 'inner');
    expect(innerDetailedAfterRow!.gridColumnIds).toEqual(innerDetailedBeforeRow!.gridColumnIds);
    expect(innerDetailedAfterRow!.tableId).toBe(innerIdBeforeRow);
    expect(innerDetailedAfterRow!.rows.length).toBe(innerDetailedBeforeRow!.rows.length + 1);
    const rowsAfterFurnitureInsert = readback!.inner!.rowCount;
    expect(readback?.outer?.columnWidthsTwips.join(',')).toBe(outerBaseline.columnWidthsTwips.join(','));
    expect(readback?.outer?.tableId).toBe(outerBaseline.tableId);
    await capture(page, 'task12-04-inner-row-inserted');

    await focusInnerCell(page, { rowCount: rowsAfterFurnitureInsert, columnCount: 2 });
    const colsBefore = readback!.inner!.columnWidthsTwips.length;
    const outerGridBeforeColumn = readback!.outer!.columnWidthsTwips.join(',');
    const innerIdBeforeColumn = readback!.inner!.tableId;
    const outerIdBeforeColumn = readback!.outer!.tableId;
    const innerDetailedBeforeColumn = await e2eDetailedTopology(page, 'inner');
    expect(innerDetailedBeforeColumn).not.toBeNull();
    const columnInsertPoint = await hoverEdge(page, 'insert-column', { column: 0 });
    const { gridColumnId: insertedAtColumn } = await clickInsertColumnFurniture(
      page,
      innerIdBeforeColumn,
      columnInsertPoint
    );
    expect(innerDetailedBeforeColumn!.gridColumnIds).toContain(insertedAtColumn);
    readback = await e2eReadback(page);
    expect(readback?.inner?.columnWidthsTwips.length).toBe(colsBefore + 1);
    expect(readback?.inner?.tableId).toBe(innerIdBeforeColumn);
    expect(readback?.outer?.tableId).toBe(outerIdBeforeColumn);
    expect(readback?.outer?.columnWidthsTwips.join(',')).toBe(outerGridBeforeColumn);
    const innerDetailedAfterColumn = await e2eDetailedTopology(page, 'inner');
    expect(innerDetailedAfterColumn!.gridColumnIds.length).toBe(
      innerDetailedBeforeColumn!.gridColumnIds.length + 1
    );
    expect(innerDetailedAfterColumn!.tableId).toBe(innerIdBeforeColumn);
    await capture(page, 'task12-05-inner-column-inserted');

    await focusInnerCell(page, {
      rowCount: rowsAfterFurnitureInsert,
      columnCount: colsBefore + 1,
    });
    const innerCell = page.locator('.docx-paragraph-fragment').filter({ hasText: 'INNER-NW' }).first();
    const innerBox = await innerCell.boundingBox();
    if (!innerBox) throw new Error('inner cell box missing');
    await page.mouse.click(innerBox.x + innerBox.width / 2, innerBox.y + innerBox.height / 2, {
      button: 'right',
    });
    const menu = page.locator('.docx-contextmenu');
    await expect(menu).toBeVisible();
    await menu.locator('[data-slot="table.insertRowBelow"]').click();
    await settle(page);
    readback = await e2eReadback(page);
    expect(readback?.inner?.rowCount).toBe(rowsAfterFurnitureInsert + 1);
    await capture(page, 'task12-06-context-row-below');

    const rowsAfterContextInsert = readback!.inner!.rowCount;
    const innerTableIdBeforeDelete = readback!.inner!.tableId;
    const deleteCell = page.locator('.docx-paragraph-fragment').filter({ hasText: 'INNER-SW' }).first();
    await expect(deleteCell).toBeVisible();
    const deleteBox = await deleteCell.boundingBox();
    if (!deleteBox) throw new Error('inner SW cell box missing for delete');
    await page.mouse.click(deleteBox.x + deleteBox.width / 2, deleteBox.y + deleteBox.height / 2, {
      button: 'right',
    });
    const deleteMenu = page.locator('.docx-contextmenu');
    await expect(deleteMenu).toBeVisible();
    const deleteRow = deleteMenu.locator('[data-slot="table.deleteRow"]');
    await expect(deleteRow).toBeEnabled();
    await deleteRow.click();
    await settle(page);
    readback = await e2eReadback(page);
    expect(readback?.inner?.tableId).toBe(innerTableIdBeforeDelete);
    expect(readback?.inner?.rowCount).toBe(rowsAfterContextInsert - 1);
    await capture(page, 'task12-06b-context-row-deleted');

    await focusInnerCell(page, {
      rowCount: rowsAfterContextInsert - 1,
      columnCount: colsBefore + 1,
    });
    const topoBeforeRect = await e2eDetailedTopology(page, 'inner');
    expect(topoBeforeRect).not.toBeNull();
    const nwRowIndex = topoBeforeRect!.rows.findIndex((row) =>
      row.cells.some((cell) => cell.text.includes('INNER-NW'))
    );
    expect(nwRowIndex).toBeGreaterThanOrEqual(0);
    const rectFromRow = nwRowIndex;
    const rectFromCol = 0;
    const rectToRow = Math.min(nwRowIndex + 1, topoBeforeRect!.rowCount - 1);
    const rectToCol = Math.min(1, topoBeforeRect!.columnWidthsTwips.length - 1);
    const startParagraphId = topoBeforeRect!.rows[rectFromRow]!.cells[rectFromCol]!.paragraphIds[0]!;
    const endParagraphId = topoBeforeRect!.rows[rectToRow]!.cells[rectToCol]!.paragraphIds[0]!;
    await dragCellRectangle(
      page,
      [rectFromRow, rectFromCol],
      [rectToRow, rectToCol],
      { startParagraphId, endParagraphId }
    );
    const cellSelection = await e2eGetCellSelection(page);
    expect(cellSelection?.tableId).toBe(readback!.inner!.tableId);
    expect(cellSelection?.rows).toEqual({
      from: Math.min(rectFromRow, rectToRow),
      to: Math.max(rectFromRow, rectToRow),
    });
    expect(cellSelection?.columns).toEqual({
      from: Math.min(rectFromCol, rectToCol),
      to: Math.max(rectFromCol, rectToCol),
    });
    expect(cellSelection?.cellIds.length).toBe(
      (Math.abs(rectToRow - rectFromRow) + 1) * (Math.abs(rectToCol - rectFromCol) + 1)
    );
    const detailedBeforeFormat = topoBeforeRect!;
    const preFormatInnerSnapshot = detailedBeforeFormat;
    const selectionOracle = {
      rowFrom: Math.min(rectFromRow, rectToRow),
      rowTo: Math.max(rectFromRow, rectToRow),
      colFrom: Math.min(rectFromCol, rectToCol),
      colTo: Math.max(rectFromCol, rectToCol),
    };
    const selectedCellIds = cellIdsInSelectionRectangle(preFormatInnerSnapshot, selectionOracle);
    expect(new Set(cellSelection!.cellIds)).toEqual(new Set(selectedCellIds));
    assertSelectionIdPartition(preFormatInnerSnapshot, selectionOracle, selectedCellIds);
    const borderSpec = { val: 'dotted', sz: '8', color: '336699' } as const;
    const fillHex = '0070C0';

    const assertFormatted = (
      edited: Parameters<typeof assertTableFormattingOracle>[0],
      options?: { allowUnselectedWidthDrift?: boolean }
    ) => {
      assertTableFormattingOracle(
        edited,
        preFormatInnerSnapshot,
        selectionOracle,
        borderSpec,
        fillHex,
        options
      );
    };

    await pickToolbarOption(page, 'table.borderTarget', 'inside');
    await pickToolbarOption(page, 'table.borderStyle', 'dotted');
    await pickToolbarOption(page, 'table.borderWidth', '8');
    const borderColor = page.locator('[data-slot="table.borderColor"]').first();
    await borderColor.locator('.docx-toolbar__colorsplit-caret').click();
    await borderColor.locator('[data-value="336699"]').click();
    await settle(page);
    const fillColor = page.locator('[data-slot="table.cellFill"]').first();
    await fillColor.locator('.docx-toolbar__colorsplit-caret').click();
    await fillColor.locator('[data-value="0070C0"]').click();
    await settle(page);

    const postFormatDetailed = await e2eDetailedTopology(page, 'inner');
    expect(postFormatDetailed).not.toBeNull();
    assertFormatted(postFormatDetailed!);
    const bytesAfterFormatRaw = await e2eSaveBytes(page);
    const bytesAfterFormat = bytesAfterFormatRaw ? Uint8Array.from(bytesAfterFormatRaw) : null;
    expect(bytesAfterFormat).not.toBeNull();
    const partAfterFormat = readTableEditingPackage(bytesAfterFormat!);
    const savedAfterFormat = detailedTableSnapshot(findInnerTable(partAfterFormat));
    assertFormatted(savedAfterFormat);
    await capture(page, 'task12-07-inner-borders-fill');

    expect(await e2eCanUndo(page)).toBe(true);
    let undoSteps = 0;
    for (let step = 0; step < 8; step += 1) {
      const currentDetailed = await e2eDetailedTopology(page, 'inner');
      if (currentDetailed && detailedTopologyContentEqual(currentDetailed, preFormatInnerSnapshot)) break;
      expect(await e2eCanUndo(page)).toBe(true);
      await undoViaToolbar(page);
      undoSteps += 1;
    }
    const postUndoDetailed = await e2eDetailedTopology(page, 'inner');
    expect(postUndoDetailed?.tableId).toBe(preFormatInnerSnapshot.tableId);
    expect(postUndoDetailed?.rowCount).toBe(preFormatInnerSnapshot.rowCount);
    expect(postUndoDetailed?.columnWidthsTwips).toEqual(preFormatInnerSnapshot.columnWidthsTwips);
    assertAllInnerCellsMatchPreFormat(postUndoDetailed!, preFormatInnerSnapshot);
    const postUndoPart = readTableEditingPackage(Uint8Array.from((await e2eSaveBytes(page))!));
    const postUndoSaved = detailedTableSnapshot(findInnerTable(postUndoPart));
    assertAllInnerCellsMatchPreFormat(postUndoSaved, preFormatInnerSnapshot);
    await capture(page, 'task12-08-after-undo');

    expect(await e2eCanRedo(page)).toBe(true);
    for (let step = 0; step < undoSteps; step += 1) {
      await redoViaKeyboard(page);
    }
    const postRedoDetailed = await e2eDetailedTopology(page, 'inner');
    expect(detailedTopologyContentEqual(postRedoDetailed!, postFormatDetailed!)).toBe(true);
    assertFormatted(postRedoDetailed!);
    const postRedoPart = readTableEditingPackage(Uint8Array.from((await e2eSaveBytes(page))!));
    const savedPostRedo = detailedTableSnapshot(findInnerTable(postRedoPart));
    assertFormatted(savedPostRedo);

    const remounted = await e2eRemountAtZoom(page, 1.25);
    expect(remounted).toEqual({ ok: true });
    expect(await e2eGetZoom(page)).toBe(1.25);
    expect(await e2eGetRenderScale(page)).toBeCloseTo(1.25 * (96 / 72), 5);
    await page.waitForFunction(() =>
      window.__DOCX_EDITOR_E2E__!.readback()?.inner?.cellTexts.some((text) => text.includes('INNER-NW'))
    );
    await settle(page);

    const scrolledAway = await page.evaluate(() =>
      window.__DOCX_EDITOR_E2E__!.scrollToParagraph('Scroll filler paragraph 10')
    );
    expect(scrolledAway).toBe(true);
    await settle(page);

    readback = await e2eReadback(page);
    const innerIdAtZoom = readback!.inner!.tableId;
    const widthsBeforeZoomDivider = readback!.inner!.columnWidthsTwips;
    await focusInnerCell(page, {
      rowCount: readback!.inner!.rowCount,
      columnCount: readback!.inner!.columnWidthsTwips.length,
    });
    await hoverEdge(page, 'divider', { dividerIndex: 1, row: 0 });
    const dividerHandle = page.locator('.docx-table-divider-handle').first();
    await expect(dividerHandle).toBeVisible();
    mkdirSync(SCREENSHOTS, { recursive: true });
    await dividerHandle.screenshot({ path: path.join(SCREENSHOTS, 'task12-09-zoom-divider-handle.png') });
    await dragFromHandle(page, '.docx-table-divider-handle', 10, 0);
    readback = await e2eReadback(page);
    expect(readback?.inner?.tableId).toBe(innerIdAtZoom);
    expect(readback?.inner?.columnWidthsTwips[0]).not.toBe(widthsBeforeZoomDivider[0]);
    expect(readback?.inner?.columnWidthsTwips[1]).not.toBe(widthsBeforeZoomDivider[1]);
    expect(readback?.outer?.columnWidthsTwips.join(',')).toBe(outerBaseline.columnWidthsTwips.join(','));
    await capture(page, 'task12-09-zoom-scroll-divider');

    readback = await e2eReadback(page);
    await focusInnerCell(page, {
      rowCount: readback!.inner!.rowCount,
      columnCount: readback!.inner!.columnWidthsTwips.length,
    });
    const selected = await e2eGetSelectedTable(page);
    expect(selected?.rowCount).toBe(readback!.inner!.rowCount);
    expect(selected?.blockId).toBe(readback!.inner!.tableId);

    const preSaveFingerprint = await e2eFingerprint(page);
    expect(preSaveFingerprint).not.toBe(baselineFingerprint);
    const preSaveRaw = await e2eSaveBytes(page);
    const preSave = preSaveRaw ? Uint8Array.from(preSaveRaw) : null;
    expect(preSave).not.toBeNull();
    const prePart = readTableEditingPackage(preSave!);
    const preSaveInnerDetailed = detailedTableSnapshot(findInnerTable(prePart));
    assertFormatted(preSaveInnerDetailed, { allowUnselectedWidthDrift: true });
    expect(saveReopenDigestDiff(prePart, prePart)).toEqual([]);
    expect(outerTableIsolationFingerprint(prePart)).toBe(outerIsolationBaseline);

    const reopened = await e2eSaveAndReopen(page);
    expect(reopened.ok).toBe(true);
    const postSaveRaw = await e2eSaveBytes(page);
    const postSave = postSaveRaw ? Uint8Array.from(postSaveRaw) : null;
    const postPart = readTableEditingPackage(postSave!);
    expect(await e2eFingerprint(page)).toBe(preSaveFingerprint);
    expect(saveReopenDigestDiff(prePart, postPart)).toEqual([]);
    expect(readback?.outer?.columnWidthsTwips).toEqual(outerBaseline.columnWidthsTwips);
    expect(readback?.outer?.tableId).toBe(outerBaseline.tableId);
    expect(outerTableIsolationEqual(loadedPart, postPart)).toBe(true);
    expect(outerTableIsolationEqual(loadedPart, prePart)).toBe(true);
    expect(outerTableIsolationEqual(prePart, postPart)).toBe(true);

    const innerAfterReopen = detailedTableSnapshot(findInnerTable(postPart));
    expect(innerAfterReopen).toEqual(preSaveInnerDetailed);
    assertFormatted(innerAfterReopen, { allowUnselectedWidthDrift: true });
    await capture(page, 'task12-10-save-reopen');
  });

  test('merged-table column insert exposes the engine refusal reason', async ({ page }) => {
    await waitForHook(page);
    await focusParagraph(page, 'MERGED-ONLY');
    const refusal = await e2eCan(page, { type: 'insertColumn', where: 'right' });
    expect(refusal.ok).toBe(false);
    if (refusal.ok) return;
    expect(refusal.reason.toLowerCase()).toContain('merge');
    const mergedCell = page.locator('.docx-paragraph-fragment').filter({ hasText: 'MERGED-ONLY' }).first();
    const box = await mergedCell.boundingBox();
    if (!box) throw new Error('merged cell box missing');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    const menu = page.locator('.docx-contextmenu');
    await expect(menu).toBeVisible();
    const row = menu.locator('[data-slot="table.insertColumnRight"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await capture(page, 'task12-11-merged-column-refused');
  });
});
