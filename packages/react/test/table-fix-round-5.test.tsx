// Task 10 fix round 5 — exact seven-row model/cellSelection matrix, complete keyboard/asChild
// coverage, and safe table admission cache collision proofs.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { forwardRef, type ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { cellSelectionBetween } from '../../core/src/layout/semantic-cell-selection.ts';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DEFAULT_TABLE_CHROME_DRAFT } from '@docx-editor.dev/core-contract/editor';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';
import {
  resetTableChromeStateDerivationCount,
  tableAdmissionSliceForTest,
  tableChromeStateDerivationCount,
} from '../src/editor/toolbar/useTableChrome.tsx';

const W = WML_NAMESPACE_URI;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string) => `<w:tc>${content}</w:tc>`;

function docx(body: string): Uint8Array {
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
  });
}

const TABLE_2X2 = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr>${tc(p('A1'))}${tc(p('B1'))}</w:tr>` +
    `<w:tr>${tc(p('A2'))}${tc(p('B2'))}</w:tr></w:tbl>`
);

const TABLE_WITH_LEAD = docx(
  p('lead') +
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr>${tc(p('A1'))}${tc(p('B1'))}</w:tr>` +
    `<w:tr>${tc(p('A2'))}${tc(p('B2'))}</w:tr></w:tbl>`
);

const TWO_TABLES_2X2 = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr>${tc(p('T1A1'))}${tc(p('T1B1'))}</w:tr>` +
    `<w:tr>${tc(p('T1A2'))}${tc(p('T1B2'))}</w:tr></w:tbl>` +
    p('gap') +
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr>${tc(p('T2A1'))}${tc(p('T2B1'))}</w:tr>` +
    `<w:tr>${tc(p('T2A2'))}${tc(p('T2B2'))}</w:tr></w:tbl>`
);

const MERGED_THEN_NORMAL = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr>${tc(p('M1'))}` +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' +
    p('span') + '</w:tc></w:tr></w:tbl>' +
    p('gap') +
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr>${tc(p('N1'))}${tc(p('N2'))}</w:tr>` +
    `<w:tr>${tc(p('N3'))}${tc(p('N4'))}</w:tr></w:tbl>`
);

const TABLE_FOREIGN = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:tcBorders><w:left w:val="single" w:sz="8" w:color="00AA00" w:space="0"/></w:tcBorders>` +
    `<w:shd w:val="pct10" w:color="222222"/></w:tcPr>${p('A1')}</w:tc>${tc(p('B1'))}</w:tr>` +
    `<w:tr>${tc(p('A2'))}${tc(p('B2'))}</w:tr></w:tbl>`
);

interface ModelSelectionSnap {
  readonly anchor: { readonly paragraphId: string; readonly offset: number };
  readonly head: { readonly paragraphId: string; readonly offset: number };
  readonly collapsed: boolean;
}

interface CellSelectionSnap {
  readonly tableId: string;
  readonly cellIds: readonly string[];
  readonly rows: { readonly from: number; readonly to: number };
  readonly columns: { readonly from: number; readonly to: number };
}

function collectByKind(root: OoxmlNode, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
}

function tableColumnCount(part: OoxmlPart): number {
  const table = collectByKind(part.root, 'table')[0];
  const grid = table && wmlChild(table, 'tblGrid');
  return grid?.children?.filter((c) => c.kind !== 'textValue' && c.localName === 'gridCol').length ?? 0;
}

function wmlChild(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  return node.children?.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === localName
  );
}

function paragraphText(part: OoxmlPart, paragraphId: string): string {
  const para = collectByKind(part.root, 'paragraph').find((node) => node.id === paragraphId);
  if (!para) return '';
  let text = '';
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') text += node.value;
    else for (const child of node.children ?? []) visit(child);
  };
  visit(para);
  return text;
}

function modelSelection(editor: DocxEditorInstance): ModelSelectionSnap {
  const s = editor.surface!.state().selection;
  return {
    anchor: { paragraphId: s.anchor.paragraphId, offset: s.anchor.offset },
    head: { paragraphId: s.head.paragraphId, offset: s.head.offset },
    collapsed: s.anchor.paragraphId === s.head.paragraphId && s.anchor.offset === s.head.offset,
  };
}

function tableOnPage(editor: DocxEditorInstance) {
  const table = editor.surface!.layout().pages[0]!.fragments.find((f) => f.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('no table');
  return table;
}

function tableIdOnPage(editor: DocxEditorInstance): string {
  return tableOnPage(editor).tableId;
}

function paragraphIdAtCell(editor: DocxEditorInstance, row: number, col: number): string {
  const table = tableOnPage(editor);
  const rowRec = table.rows[row]!;
  const cell = rowRec.cells.find((c) => c.gridColumn === col)!;
  for (const block of cell.blocks) {
    if (block.kind === 'paragraph') return block.paragraphId;
  }
  throw new Error(`no paragraph at row ${row} col ${col}`);
}

function cellIdAt(tableId: string, row: number, col: number): string {
  return `${tableId}.${row + 1}.${col}`;
}

function expectedRect2x2(tableId: string): CellSelectionSnap {
  return {
    tableId,
    cellIds: [
      cellIdAt(tableId, 0, 0),
      cellIdAt(tableId, 0, 1),
      cellIdAt(tableId, 1, 0),
      cellIdAt(tableId, 1, 1),
    ],
    rows: { from: 0, to: 1 },
    columns: { from: 0, to: 1 },
  };
}

function expectedRectModel(editor: DocxEditorInstance): ModelSelectionSnap {
  const headId = paragraphIdAtCell(editor, 1, 1);
  const headLen = paragraphText(editor.surface!.session.part(), headId).length;
  return {
    anchor: { paragraphId: paragraphIdAtCell(editor, 0, 0), offset: 0 },
    head: { paragraphId: headId, offset: headLen },
    collapsed: false,
  };
}

function collapsedAt(paragraphId: string, offset: number): ModelSelectionSnap {
  return {
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
    collapsed: true,
  };
}

function leadParagraphId(editor: DocxEditorInstance): string {
  return collectByKind(editor.surface!.session.part().root, 'paragraph')[0]!.id;
}

function setupRect2x2(editor: DocxEditorInstance): {
  readonly cell: CellSelectionSnap;
  readonly model: ModelSelectionSnap;
} {
  const tableId = tableIdOnPage(editor);
  selectCellRect(editor, 0, 0, 1, 1);
  return { cell: expectedRect2x2(tableId), model: expectedRectModel(editor) };
}

function cellSelectionSnap(editor: DocxEditorInstance): CellSelectionSnap | null {
  const c = editor.surface!.state().cellSelection;
  if (!c) return null;
  return {
    tableId: c.tableId,
    cellIds: [...c.cellIds],
    rows: { ...c.rows },
    columns: { ...c.columns },
  };
}

function expectModel(editor: DocxEditorInstance, expected: ModelSelectionSnap): void {
  expect(modelSelection(editor)).toEqual(expected);
}

function expectCell(editor: DocxEditorInstance, expected: CellSelectionSnap | null): void {
  expect(cellSelectionSnap(editor)).toEqual(expected);
}

function mount(
  toolbar?: ReactNode,
  source = TABLE_2X2,
  rootProps: Record<string, unknown> = {}
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance; unmount: () => void } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
      {...rootProps}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        {toolbar}
        <ContextMenu t={(key) => key} />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance!, unmount: view.unmount };
}

function pagesEl(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector('.docx-pages') as HTMLElement;
}

async function waitReady(editor: () => DocxEditorInstance): Promise<DocxEditorInstance> {
  for (let i = 0; i < 200; i++) {
    const instance = editor();
    if (instance?.surface) return instance;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  }
  throw new Error('editor not ready');
}

function caretInCell(editor: DocxEditorInstance, paragraphIndex = 0, offset = 1): void {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  });
}

function caretInParagraphWithText(editor: DocxEditorInstance, text: string, offset = 1): void {
  const part = editor.surface!.session.part();
  for (const id of editor.surface!.session.paragraphIds()) {
    if (paragraphText(part, id) === text) {
      act(() => {
        editor.surface!.setSelection({
          anchor: { paragraphId: id, offset },
          head: { paragraphId: id, offset },
        });
      });
      return;
    }
  }
  throw new Error(`paragraph not found: ${text}`);
}

function selectCellRect(
  editor: DocxEditorInstance,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number
): CellSelectionSnap {
  const surface = editor.surface!;
  const layout = surface.layout();
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('no table');
  const addr = (row: number, col: number) => {
    const rowRec = table.rows[row]!;
    const cell = rowRec.cells.find((c) => c.gridColumn === col)!;
    return {
      tableId: table.tableId,
      rowId: rowRec.id,
      cellId: cell.id,
      rowIndex: row,
      gridColumn: cell.gridColumn,
      gridSpan: cell.gridSpan,
    };
  };
  const rect = cellSelectionBetween(layout, addr(fromRow, fromCol), addr(toRow, toCol));
  if (!rect) throw new Error('rect failed');
  act(() => {
    surface.setCellSelection(rect);
  });
  return {
    tableId: rect.tableId,
    cellIds: [...rect.cellIds],
    rows: { ...rect.rows },
    columns: { ...rect.columns },
  };
}

function documentPart(editor: DocxEditorInstance): OoxmlPart {
  return editor.surface!.session.part();
}

function panel(view: ReturnType<typeof render>): HTMLElement | null {
  return view.container.querySelector('.docx-contextmenu');
}

function rightClick(view: ReturnType<typeof render>): void {
  act(() => {
    fireEvent.contextMenu(view.container.querySelector('.docx-paginated-surface') as HTMLElement, {
      clientX: 120,
      clientY: 140,
      button: 2,
    });
  });
}

function rowNamed(view: ReturnType<typeof render>, slot: string): HTMLElement {
  const element = panel(view)?.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!element) throw new Error(`no row for ${slot}`);
  return element;
}

function borderSideAttrs(cell: OoxmlElement, side: 'top' | 'left' | 'bottom' | 'right'): Record<string, string> {
  const tcPr = wmlChild(cell, 'tcPr');
  const tcBorders = tcPr && wmlChild(tcPr, 'tcBorders');
  const sideEl = tcBorders && wmlChild(tcBorders, side);
  if (!sideEl) return {};
  const out: Record<string, string> = {};
  for (const attr of sideEl.attributes) {
    if (attr.localName) out[attr.localName] = String(attr.value);
  }
  return out;
}

function firstCell(editor: DocxEditorInstance): OoxmlElement {
  return collectByKind(documentPart(editor).root, 'tableCell')[0]!;
}

async function pickTargetAsync(view: ReturnType<typeof render>, value: string): Promise<void> {
  const root = view.container.querySelector('[data-slot="table.borderTarget"]')!;
  await act(async () => {
    (root.querySelector('button') as HTMLButtonElement).click();
  });
  await act(async () => {
    const item = [...root.querySelectorAll('[role="menuitemradio"]')].find(
      (el) => el.getAttribute('data-value') === value
    ) as HTMLButtonElement | undefined;
    if (!item) throw new Error(`target missing: ${value}`);
    item.click();
  });
}

afterEach(() => cleanup());

describe('Task 10 fix round 5', () => {
  test('seven context rows: identity-exact model, cellSelection, undo, redo', async () => {
    const ANCHOR_ROW = 0;
    const ANCHOR_COL = 0;

    type Landing =
      | { readonly kind: 'insertCell'; readonly row: number; readonly col: number }
      | { readonly kind: 'survivorPid' }
      | { readonly kind: 'lead' };

    type UndoLanding =
      | { readonly kind: 'anchorCell'; readonly row: number; readonly col: number; readonly offset: number }
      | { readonly kind: 'survivorPid'; readonly offset: number }
      | { readonly kind: 'lead'; readonly offset: number };

    const cases: Array<{
      slot: string;
      source: Uint8Array;
      rowsAfter: number;
      colsAfter: number;
      tablesAfter: number;
      afterLanding: Landing;
      undoLanding: UndoLanding;
    }> = [
      {
        slot: 'table.insertRowAbove',
        source: TABLE_2X2,
        rowsAfter: 3,
        colsAfter: 2,
        tablesAfter: 1,
        afterLanding: { kind: 'insertCell', row: 0, col: ANCHOR_COL },
        undoLanding: { kind: 'anchorCell', row: ANCHOR_ROW, col: ANCHOR_COL, offset: 0 },
      },
      {
        slot: 'table.insertRowBelow',
        source: TABLE_2X2,
        rowsAfter: 3,
        colsAfter: 2,
        tablesAfter: 1,
        afterLanding: { kind: 'insertCell', row: ANCHOR_ROW + 1, col: ANCHOR_COL },
        undoLanding: { kind: 'anchorCell', row: ANCHOR_ROW, col: ANCHOR_COL, offset: 0 },
      },
      {
        slot: 'table.insertColumnLeft',
        source: TABLE_2X2,
        rowsAfter: 2,
        colsAfter: 3,
        tablesAfter: 1,
        afterLanding: { kind: 'insertCell', row: ANCHOR_ROW, col: 0 },
        undoLanding: { kind: 'anchorCell', row: ANCHOR_ROW, col: ANCHOR_COL, offset: 0 },
      },
      {
        slot: 'table.insertColumnRight',
        source: TABLE_2X2,
        rowsAfter: 2,
        colsAfter: 3,
        tablesAfter: 1,
        afterLanding: { kind: 'insertCell', row: ANCHOR_ROW, col: ANCHOR_COL + 1 },
        undoLanding: { kind: 'anchorCell', row: ANCHOR_ROW, col: ANCHOR_COL, offset: 0 },
      },
      {
        slot: 'table.deleteRow',
        source: TABLE_2X2,
        rowsAfter: 1,
        colsAfter: 2,
        tablesAfter: 1,
        afterLanding: { kind: 'survivorPid' },
        undoLanding: { kind: 'survivorPid', offset: 0 },
      },
      {
        slot: 'table.deleteColumn',
        source: TABLE_2X2,
        rowsAfter: 2,
        colsAfter: 1,
        tablesAfter: 1,
        afterLanding: { kind: 'survivorPid' },
        undoLanding: { kind: 'survivorPid', offset: 0 },
      },
      {
        slot: 'table.deleteTable',
        source: TABLE_WITH_LEAD,
        rowsAfter: 0,
        colsAfter: 0,
        tablesAfter: 0,
        afterLanding: { kind: 'lead' },
        undoLanding: { kind: 'lead', offset: 0 },
      },
    ];

    function afterModel(
      editor: DocxEditorInstance,
      landing: Landing,
      survivorPid: string | undefined
    ): ModelSelectionSnap {
      switch (landing.kind) {
        case 'insertCell':
          return collapsedAt(paragraphIdAtCell(editor, landing.row, landing.col), 0);
        case 'survivorPid':
          return collapsedAt(survivorPid!, 0);
        case 'lead':
          return collapsedAt(leadParagraphId(editor), 0);
      }
    }

    function undoModel(
      editor: DocxEditorInstance,
      landing: UndoLanding,
      survivorPid: string | undefined
    ): ModelSelectionSnap {
      switch (landing.kind) {
        case 'anchorCell':
          return collapsedAt(paragraphIdAtCell(editor, landing.row, landing.col), landing.offset);
        case 'survivorPid':
          return collapsedAt(survivorPid!, landing.offset);
        case 'lead':
          return collapsedAt(leadParagraphId(editor), landing.offset);
      }
    }

    for (const rowCase of cases) {
      const { view, editor, unmount } = mount(undefined, rowCase.source);
      await waitReady(editor);
      const pages = pagesEl(view);
      pages.focus();

      const before = setupRect2x2(editor());
      expectCell(editor(), before.cell);
      expectModel(editor(), before.model);

      let survivorPid: string | undefined;
      if (rowCase.afterLanding.kind === 'survivorPid') {
        survivorPid =
          rowCase.slot === 'table.deleteRow'
            ? paragraphIdAtCell(editor(), 1, ANCHOR_COL)
            : paragraphIdAtCell(editor(), ANCHOR_ROW, 1);
      }

      const surface = editor().surface!;
      const partBefore = documentPart(editor());
      const rowsBefore = collectByKind(partBefore.root, 'tableRow').length;
      const colsBefore = tableColumnCount(partBefore);
      const tablesBefore = collectByKind(partBefore.root, 'table').length;
      const revisionBefore = surface.session.revision();
      const selectionBefore = modelSelection(editor());
      const cellBefore = cellSelectionSnap(editor())!;
      expect(document.activeElement).toBe(pages);

      rightClick(view);
      const row = rowNamed(view, rowCase.slot);
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      act(() => {
        row.dispatchEvent(down);
      });
      expect(down.defaultPrevented).toBe(true);
      expectModel(editor(), selectionBefore);
      expectCell(editor(), cellBefore);

      await act(async () => {
        fireEvent.click(row);
      });
      expect(surface.session.revision()).toBe(revisionBefore + 1);
      const part = documentPart(editor());
      if (rowCase.tablesAfter === 0) {
        expect(collectByKind(part.root, 'table').length).toBe(0);
      } else {
        expect(collectByKind(part.root, 'tableRow').length).toBe(rowCase.rowsAfter);
        expect(tableColumnCount(part)).toBe(rowCase.colsAfter);
        expect(collectByKind(part.root, 'table').length).toBe(rowCase.tablesAfter);
      }
      expectModel(editor(), afterModel(editor(), rowCase.afterLanding, survivorPid));
      expectCell(editor(), null);
      expect(panel(view)).toBeNull();
      expect(document.activeElement).toBe(pages);

      await act(async () => {
        editor().exec({ type: 'undo' });
      });
      const partUndo = documentPart(editor());
      expect(collectByKind(partUndo.root, 'tableRow').length).toBe(rowsBefore);
      expect(tableColumnCount(partUndo)).toBe(colsBefore);
      expect(collectByKind(partUndo.root, 'table').length).toBe(tablesBefore);
      expectModel(editor(), undoModel(editor(), rowCase.undoLanding, survivorPid));
      expectCell(editor(), null);
      expect(document.activeElement).toBe(pages);

      await act(async () => {
        editor().exec({ type: 'redo' });
      });
      if (rowCase.tablesAfter === 0) {
        expect(collectByKind(documentPart(editor()).root, 'table').length).toBe(0);
      } else {
        expect(collectByKind(documentPart(editor()).root, 'tableRow').length).toBe(rowCase.rowsAfter);
        expect(tableColumnCount(documentPart(editor()))).toBe(rowCase.colsAfter);
      }
      expectModel(editor(), afterModel(editor(), rowCase.afterLanding, survivorPid));
      expectCell(editor(), null);
      expect(surface.session.revision()).toBe(revisionBefore + 3);
      expect(document.activeElement).toBe(pages);
      unmount();
    }
  });

  test('context refusals: zero revision, selection, focus, menu stays open', async () => {
    const MERGED_TABLE = docx(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
        `<w:tr>${tc(p('A1'))}<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p('span')}</w:tc></w:tr></w:tbl>`
    );
    const ONE_ROW_TABLE = docx(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>' + p('only') + '</w:tc></w:tr></w:tbl>'
    );
    const ONE_COL_TABLE = docx(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>' + p('only') + '</w:tc></w:tr></w:tbl>'
    );

    for (const [source, slot, reason] of [
      [MERGED_TABLE, 'table.insertColumnRight', 'this table has merged cells'],
      [ONE_ROW_TABLE, 'table.deleteRow', 'the table must keep at least one row or column'],
      [ONE_COL_TABLE, 'table.deleteColumn', 'the table must keep at least one row or column'],
    ] as const) {
      const { view, editor, unmount } = mount(undefined, source);
      await waitReady(editor);
      caretInCell(editor());
      const pages = pagesEl(view);
      pages.focus();
      const selBefore = modelSelection(editor());
      const revisionBefore = editor().surface!.session.revision();
      rightClick(view);
      const row = rowNamed(view, slot);
      expect(row.getAttribute('title')).toBe(reason);
      await act(async () => {
        fireEvent.click(row);
      });
      expect(editor().surface!.session.revision()).toBe(revisionBefore);
      expect(modelSelection(editor())).toEqual(selBefore);
      expect(cellSelectionSnap(editor())).toBeNull();
      expect(panel(view)).not.toBeNull();
      unmount();
    }

    const { view, editor, unmount } = mount(undefined, TABLE_2X2);
    await waitReady(editor);
    caretInCell(editor());
    const revisionBefore = editor().surface!.session.revision();
    const selBefore = modelSelection(editor());
    rightClick(view);
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    const row = rowNamed(view, 'table.insertRowBelow');
    expect(row.getAttribute('title')).toBe('the document is open for viewing');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(editor().surface!.session.revision()).toBe(revisionBefore);
    expect(modelSelection(editor())).toEqual(selBefore);
    expect(panel(view)).not.toBeNull();
    unmount();
  });

  test('border-color and cell-fill dialogs: keyboard swatch/clear, one revision, Escape', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderColor />
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>,
      TABLE_FOREIGN
    );
    await waitReady(editor);
    caretInCell(editor());
    await pickTargetAsync(view, 'top');
    const cellId = firstCell(editor()).id;

    for (const [slot, hex, readBorder] of [
      ['table.borderColor', '336699', true],
      ['table.cellFill', 'FFFF00', false],
    ] as const) {
      const root = view.container.querySelector(`[data-slot="${slot}"]`)!;
      const trigger = root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
      await act(async () => {
        trigger.click();
      });
      const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
      const swatch = root.querySelector(`[data-value="${hex}"]`) as HTMLButtonElement;
      expect(dialog.contains(document.activeElement)).toBe(true);
      swatch.focus();
      const revisionBefore = editor().surface!.session.revision();
      await act(async () => {
        fireEvent.keyDown(dialog, { key: 'Enter' });
      });
      expect(editor().surface!.session.revision()).toBe(revisionBefore + 1);
      expect(root.querySelector('[role="dialog"]')).toBeNull();
      if (readBorder) {
        expect(borderSideAttrs(firstCell(editor()), 'top').color?.toUpperCase()).toBe(hex);
      } else {
        const tcPr = wmlChild(firstCell(editor()), 'tcPr');
        const shd = tcPr && wmlChild(tcPr, 'shd');
        expect(shd?.attributes.find((a) => a.localName === 'fill')?.value?.toUpperCase()).toBe(hex);
      }
      await act(async () => {
        trigger.click();
      });
      fireEvent.keyDown(root.querySelector('[role="dialog"]') as HTMLElement, { key: 'Escape' });
      expect(document.activeElement).toBe(trigger);
    }

    const fillRoot = view.container.querySelector('[data-slot="table.cellFill"]')!;
    const fillTrigger = fillRoot.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
    await act(async () => {
      fillTrigger.click();
    });
    const clearBtn = fillRoot.querySelector('.docx-toolbar__swatch-clear') as HTMLButtonElement;
    clearBtn.focus();
    const revBeforeClear = editor().surface!.session.revision();
    await act(async () => {
      fireEvent.keyDown(fillRoot.querySelector('[role="dialog"]') as HTMLElement, { key: ' ' });
    });
    expect(editor().surface!.session.revision()).toBe(revBeforeClear + 1);
    const tcPr = wmlChild(collectByKind(documentPart(editor()).root, 'tableCell').find((c) => c.id === cellId)!, 'tcPr');
    const shd = tcPr && wmlChild(tcPr, 'shd');
    const fill = shd?.attributes.find((a) => a.localName === 'fill')?.value;
    expect(fill).toBeUndefined();
  });

  test('target/style/width menu keyboard: focus, Home/End, arrows, Enter/Space, Escape', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderStyle />
        <DocxEditorToolbar.TableBorderWidth />
      </DocxEditorToolbar>
    );
    await waitReady(editor);
    caretInCell(editor());

    const targetRoot = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    const targetTrigger = targetRoot.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      targetTrigger.click();
    });
    let menu = targetRoot.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(menu, { key: 'Home' });
    fireEvent.keyDown(menu, { key: 'End' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(targetRoot.querySelector('[role="menu"]')).toBeNull();

    await pickTargetAsync(view, 'top');
    for (const slot of ['table.borderStyle', 'table.borderWidth'] as const) {
      const root = view.container.querySelector(`[data-slot="${slot}"]`)!;
      const trigger = root.querySelector('button') as HTMLButtonElement;
      await act(async () => {
        trigger.click();
      });
      menu = root.querySelector('[role="menu"]') as HTMLElement;
      expect(menu.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(menu, { key: 'Home' });
      fireEvent.keyDown(menu, { key: 'End' });
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      fireEvent.keyDown(menu, { key: ' ' });
      expect(root.querySelector('[role="menu"]')).toBeNull();
      await act(async () => {
        trigger.click();
      });
      fireEvent.keyDown(root.querySelector('[role="menu"]') as HTMLElement, { key: 'Escape' });
      expect(document.activeElement).toBe(trigger);
    }
  });

  test('all five compounds: custom asChild Trigger and Item keyboard activation', async () => {
    const CustomTrigger = forwardRef<HTMLButtonElement, { onClick?: () => void }>((props, ref) => (
      <button type="button" ref={ref} data-testid="custom-trigger" {...props}>
        open
      </button>
    ));
    const CustomItem = forwardRef<HTMLButtonElement, { onClick?: () => void }>((props, ref) => (
      <button type="button" ref={ref} data-testid="custom-item" {...props}>
        pick
      </button>
    ));

    const compounds = [
      {
        name: 'TableBorderTarget',
        toolbar: (
          <DocxEditorToolbar.TableBorderTarget>
            <DocxEditorToolbar.TableBorderTarget.Trigger asChild>
              <CustomTrigger />
            </DocxEditorToolbar.TableBorderTarget.Trigger>
            <DocxEditorToolbar.TableBorderTarget.Content>
              <DocxEditorToolbar.TableBorderTarget.Item value="top" asChild>
                <CustomItem />
              </DocxEditorToolbar.TableBorderTarget.Item>
            </DocxEditorToolbar.TableBorderTarget.Content>
          </DocxEditorToolbar.TableBorderTarget>
        ),
        slot: 'table.borderTarget',
        openSelector: '[data-slot="table.borderTarget"] [data-testid="custom-trigger"]',
        itemSelector: '[data-slot="table.borderTarget"] [data-testid="custom-item"]',
        menuRole: 'menu',
        needsTarget: false,
      },
      {
        name: 'TableBorderStyle',
        toolbar: (
          <>
            <DocxEditorToolbar.TableBorderTarget />
            <DocxEditorToolbar.TableBorderStyle>
            <DocxEditorToolbar.TableBorderStyle.Trigger asChild>
              <CustomTrigger />
            </DocxEditorToolbar.TableBorderStyle.Trigger>
            <DocxEditorToolbar.TableBorderStyle.Content>
              <DocxEditorToolbar.TableBorderStyle.Item value="dashed" asChild>
                <CustomItem />
              </DocxEditorToolbar.TableBorderStyle.Item>
            </DocxEditorToolbar.TableBorderStyle.Content>
            </DocxEditorToolbar.TableBorderStyle>
          </>
        ),
        slot: 'table.borderStyle',
        openSelector: '[data-slot="table.borderStyle"] [data-testid="custom-trigger"]',
        itemSelector: '[data-slot="table.borderStyle"] [data-testid="custom-item"]',
        menuRole: 'menu',
        needsTarget: true,
      },
      {
        name: 'TableBorderWidth',
        toolbar: (
          <>
            <DocxEditorToolbar.TableBorderTarget />
            <DocxEditorToolbar.TableBorderWidth>
            <DocxEditorToolbar.TableBorderWidth.Trigger asChild>
              <CustomTrigger />
            </DocxEditorToolbar.TableBorderWidth.Trigger>
            <DocxEditorToolbar.TableBorderWidth.Content>
              <DocxEditorToolbar.TableBorderWidth.Item value="12" asChild>
                <CustomItem />
              </DocxEditorToolbar.TableBorderWidth.Item>
            </DocxEditorToolbar.TableBorderWidth.Content>
            </DocxEditorToolbar.TableBorderWidth>
          </>
        ),
        slot: 'table.borderWidth',
        openSelector: '[data-slot="table.borderWidth"] [data-testid="custom-trigger"]',
        itemSelector: '[data-slot="table.borderWidth"] [data-testid="custom-item"]',
        menuRole: 'menu',
        needsTarget: true,
      },
      {
        name: 'TableBorderColor',
        toolbar: (
          <>
            <DocxEditorToolbar.TableBorderTarget />
            <DocxEditorToolbar.TableBorderColor>
              <DocxEditorToolbar.TableBorderColor.Trigger asChild>
                <CustomTrigger />
              </DocxEditorToolbar.TableBorderColor.Trigger>
              <DocxEditorToolbar.TableBorderColor.Content>
                <DocxEditorToolbar.TableBorderColor.Item value="336699" asChild>
                  <CustomItem />
                </DocxEditorToolbar.TableBorderColor.Item>
              </DocxEditorToolbar.TableBorderColor.Content>
            </DocxEditorToolbar.TableBorderColor>
          </>
        ),
        slot: 'table.borderColor',
        openSelector: '[data-slot="table.borderColor"] [data-testid="custom-trigger"]',
        itemSelector: '[data-slot="table.borderColor"] [data-testid="custom-item"]',
        menuRole: 'dialog',
        needsTarget: true,
      },
      {
        name: 'TableCellFill',
        toolbar: (
          <DocxEditorToolbar.TableCellFill>
            <DocxEditorToolbar.TableCellFill.Trigger asChild>
              <CustomTrigger />
            </DocxEditorToolbar.TableCellFill.Trigger>
            <DocxEditorToolbar.TableCellFill.Content>
              <DocxEditorToolbar.TableCellFill.Item value="FFFF00" asChild>
                <CustomItem />
              </DocxEditorToolbar.TableCellFill.Item>
            </DocxEditorToolbar.TableCellFill.Content>
          </DocxEditorToolbar.TableCellFill>
        ),
        slot: 'table.cellFill',
        openSelector: '[data-slot="table.cellFill"] [data-testid="custom-trigger"]',
        itemSelector: '[data-slot="table.cellFill"] [data-testid="custom-item"]',
        menuRole: 'dialog',
        needsTarget: false,
      },
    ] as const;

    for (const compound of compounds) {
      const { view, editor, unmount } = mount(
        <DocxEditorToolbar preset={false}>{compound.toolbar}</DocxEditorToolbar>,
        TABLE_FOREIGN
      );
      await waitReady(editor);
      await act(async () => {
        caretInCell(editor());
      });
      if (compound.needsTarget) {
        await pickTargetAsync(view, 'top');
      }
      const trigger = view.container.querySelector(compound.openSelector) as HTMLButtonElement;
      await act(async () => {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      });
      const panel = view.container.querySelector(`[role="${compound.menuRole}"]`) as HTMLElement;
      expect(panel).not.toBeNull();
      const item = view.container.querySelector(compound.itemSelector) as HTMLButtonElement;
      item.focus();
      const revisionBefore = editor().surface!.session.revision();
      await act(async () => {
        fireEvent.keyDown(panel, { key: 'Enter' });
      });
      expect(editor().surface!.session.revision()).toBe(revisionBefore + 1);
      expect(view.container.querySelector(`[role="${compound.menuRole}"]`)).toBeNull();
      await act(async () => {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      });
      item.focus();
      await act(async () => {
        fireEvent.keyDown(view.container.querySelector(`[role="${compound.menuRole}"]`) as HTMLElement, {
          key: 'Escape',
        });
      });
      expect(document.activeElement).toBe(trigger);
      unmount();
    }
  });

  test('admission cache: distinct tables at same index re-derive with different can', async () => {
    const { view, editor } = mount(<DocxEditorToolbar />, MERGED_THEN_NORMAL);
    await waitReady(editor);
    await act(async () => {
      caretInParagraphWithText(editor(), 'M1');
    });
    resetTableChromeStateDerivationCount();
    const derivationsMerged = tableChromeStateDerivationCount();
    const mergedSlice = tableAdmissionSliceForTest(editor(), editor().snapshot());
    const mergedCan = editor().can({ type: 'insertColumn', where: 'right' }).ok;

    await act(async () => {
      caretInParagraphWithText(editor(), 'N1');
    });
    expect(tableChromeStateDerivationCount()).toBeGreaterThan(derivationsMerged);
    const normalSlice = tableAdmissionSliceForTest(editor(), editor().snapshot());
    expect(normalSlice.tableKey).not.toBe(mergedSlice.tableKey);
    expect(normalSlice.tableKey.split('|')[0]).not.toBe(mergedSlice.tableKey.split('|')[0]);
    const normalCan = editor().can({ type: 'insertColumn', where: 'right' }).ok;
    expect(mergedCan).toBe(false);
    expect(normalCan).toBe(true);
    expect(
      view.container.querySelector('[data-slot="table.borderTarget"]')
    ).not.toBeNull();
  });

  test('admission cache: two equal-dimension tables change tableKey on switch', async () => {
    const { editor } = mount(<DocxEditorToolbar />, TWO_TABLES_2X2);
    await waitReady(editor);
    await act(async () => {
      caretInParagraphWithText(editor(), 'T1A1');
    });
    const slice1 = tableAdmissionSliceForTest(editor(), editor().snapshot());
    resetTableChromeStateDerivationCount();

    await act(async () => {
      caretInParagraphWithText(editor(), 'T2A1');
    });
    const slice2 = tableAdmissionSliceForTest(editor(), editor().snapshot());
    expect(slice2.tableKey).not.toBe(slice1.tableKey);
    expect(tableChromeStateDerivationCount()).toBeGreaterThan(0);
    expect(slice1.tableKey.endsWith('|2|2|0|0')).toBe(true);
    expect(slice2.tableKey.endsWith('|2|2|0|0')).toBe(true);
  });

  test('admission cache: rectangle selection change re-derives; bold does not', async () => {
    const { editor } = mount(<DocxEditorToolbar />);
    await waitReady(editor);
    await act(async () => {
      caretInCell(editor());
    });
    resetTableChromeStateDerivationCount();
    const derivCaret = tableChromeStateDerivationCount();
    const caretSlice = tableAdmissionSliceForTest(editor(), editor().snapshot());
    expect(caretSlice.cellSelectionKey).toBe('');

    await act(async () => {
      selectCellRect(editor(), 0, 0, 1, 1);
    });
    expect(tableChromeStateDerivationCount()).toBeGreaterThan(derivCaret);
    const rectSlice = tableAdmissionSliceForTest(editor(), editor().snapshot());
    expect(rectSlice.cellSelectionKey).not.toBe('');
    expect(rectSlice.cellSelectionKey).not.toBe(caretSlice.cellSelectionKey);

    const derivAfterRect = tableChromeStateDerivationCount();
    await act(async () => {
      editor().exec({ type: 'toggleMark', mark: 'bold' });
    });
    expect(tableChromeStateDerivationCount()).toBe(derivAfterRect);
  });

  test('admission cache: structural row insert changes tableKey', async () => {
    const { editor } = mount(<DocxEditorToolbar />);
    await waitReady(editor);
    caretInCell(editor());
    const before = tableAdmissionSliceForTest(editor(), editor().snapshot());
    resetTableChromeStateDerivationCount();
    await act(async () => {
      editor().exec({ type: 'insertRow', where: 'below' });
    });
    expect(tableChromeStateDerivationCount()).toBeGreaterThan(0);
    const after = tableAdmissionSliceForTest(editor(), editor().snapshot());
    expect(after.tableKey).not.toBe(before.tableKey);
    expect(after.tableKey.split('|')[1]).toBe('3');
  });
});
