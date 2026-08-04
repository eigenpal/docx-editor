// Task 10 fix round 4 — exact persisted OOXML, seven-row context matrix,
// subscription/can performance, complete keyboard matrix, API doc grep.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { forwardRef, useRef, type ReactNode } from 'react';
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
import { editorStateActiveSubscriptionCount } from '../src/editor/useEditorState.ts';
import {
  resetTableChromeStateDerivationCount,
  tableChromeProviderSubscriptionCount,
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
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
);

const TABLE_WITH_LEAD = docx(
  '<w:p><w:r><w:t>lead</w:t></w:r></w:p>' +
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
);

const TABLE_FOREIGN = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:tcBorders><w:left w:val="single" w:sz="8" w:color="00AA00" w:space="0"/></w:tcBorders>` +
    `<w:shd w:val="pct10" w:color="222222"/></w:tcPr>${p('A1')}</w:tc>${tc(p('B1'))}</w:tr>` +
    `<w:tr>${tc(p('A2'))}${tc(p('B2'))}</w:tr></w:tbl>`
);

const ONE_ROW_TABLE = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>' + p('only') + '</w:tc></w:tr></w:tbl>'
);

const ONE_COL_TABLE = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc>' + p('only') + '</w:tc></w:tr></w:tbl>'
);

const MERGED_TABLE = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>span</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
);

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

function wmlChild(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  return node.children?.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === localName
  );
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

function shdAttrs(part: OoxmlPart, cellId: string): Record<string, string> {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return {};
  const tcPr = wmlChild(cell, 'tcPr');
  const shd = tcPr && wmlChild(tcPr, 'shd');
  if (!shd) return {};
  const out: Record<string, string> = {};
  for (const attr of shd.attributes) {
    if (attr.localName) out[attr.localName] = String(attr.value);
  }
  return out;
}

function shdFill(part: OoxmlPart, cellId: string): string | undefined {
  return shdAttrs(part, cellId).fill;
}

function tableColumnCount(part: OoxmlPart): number {
  const table = collectByKind(part.root, 'table')[0];
  const grid = table && wmlChild(table, 'tblGrid');
  return grid?.children?.filter((c) => c.kind !== 'textValue' && c.localName === 'gridCol').length ?? 0;
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

function selectionText(editor: DocxEditorInstance): string {
  const part = editor.surface!.session.part();
  const head = editor.surface!.state().selection.head.paragraphId;
  return paragraphText(part, head);
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

function selectCellRect(editor: DocxEditorInstance, fromRow: number, fromCol: number, toRow: number, toCol: number): void {
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
}

function documentPart(editor: DocxEditorInstance): OoxmlPart {
  return editor.surface!.session.part();
}

function firstCell(editor: DocxEditorInstance): OoxmlElement {
  return collectByKind(documentPart(editor).root, 'tableCell')[0]!;
}

function expectDefaultBorder(attrs: Record<string, string>): void {
  expect(attrs.val).toBe(DEFAULT_TABLE_CHROME_DRAFT.spec.style);
  expect(attrs.sz).toBe(String(DEFAULT_TABLE_CHROME_DRAFT.spec.size));
  expect(attrs.color?.toUpperCase()).toBe(
    DEFAULT_TABLE_CHROME_DRAFT.spec.color.kind === 'hex'
      ? DEFAULT_TABLE_CHROME_DRAFT.spec.color.value
      : undefined
  );
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

async function pickMenuAsync(view: ReturnType<typeof render>, slot: string, index: number): Promise<void> {
  const root = view.container.querySelector(`[data-slot="${slot}"]`)!;
  await act(async () => {
    (root.querySelector('button') as HTMLButtonElement).click();
  });
  await act(async () => {
    (root.querySelectorAll('[role="menuitemradio"]')[index] as HTMLButtonElement).click();
  });
}

async function pickColorAsync(view: ReturnType<typeof render>, hex: string): Promise<void> {
  const root = view.container.querySelector('[data-slot="table.borderColor"]')!;
  await act(async () => {
    (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
  });
  await act(async () => {
    (root.querySelector(`[data-value="${hex}"]`) as HTMLButtonElement).click();
  });
}

async function pickFillAsync(view: ReturnType<typeof render>, hex: string): Promise<void> {
  const root = view.container.querySelector('[data-slot="table.cellFill"]')!;
  await act(async () => {
    (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
  });
  await act(async () => {
    (root.querySelector(`[data-value="${hex}"]`) as HTMLButtonElement).click();
  });
}

async function clearFillAsync(view: ReturnType<typeof render>): Promise<void> {
  const root = view.container.querySelector('[data-slot="table.cellFill"]')!;
  await act(async () => {
    (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
  });
  await act(async () => {
    (root.querySelector('.docx-toolbar__swatch-clear') as HTMLButtonElement).click();
  });
}

function readDraftTarget(view: ReturnType<typeof render>): string | null {
  const trigger = view.container.querySelector('[data-slot="table.borderTarget"] button');
  return trigger?.getAttribute('aria-label') ?? null;
}

afterEach(() => cleanup());

describe('Task 10 fix round 4', () => {
  test('exact persisted React matrix reads cumulative spec and foreign payload', async () => {
    const toolbar = (
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderColor />
        <DocxEditorToolbar.TableBorderStyle />
        <DocxEditorToolbar.TableBorderWidth />
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>
    );
    const { view, editor, unmount } = mount(toolbar, TABLE_FOREIGN);
    await waitReady(editor);
    await act(async () => {
      caretInCell(editor());
    });
    const cellId = firstCell(editor()).id;
    const foreignLeftBefore = { ...borderSideAttrs(firstCell(editor()), 'left') };
    const foreignShdBefore = { ...shdAttrs(documentPart(editor()), cellId) };
    let revision = editor().surface!.session.revision();

    await pickTargetAsync(view, 'top');
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    revision++;
    const cellAfterTarget = firstCell(editor());
    expectDefaultBorder(borderSideAttrs(cellAfterTarget, 'top'));
    expect(borderSideAttrs(cellAfterTarget, 'left')).toEqual(foreignLeftBefore);
    expect(shdAttrs(documentPart(editor()), cellId)).toEqual(foreignShdBefore);

    await pickColorAsync(view, '336699');
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    revision++;
    const cellAfterColor = firstCell(editor());
    expect(borderSideAttrs(cellAfterColor, 'top').color?.toUpperCase()).toBe('336699');
    expect(borderSideAttrs(cellAfterColor, 'top').val).toBe('single');
    expect(borderSideAttrs(cellAfterColor, 'top').sz).toBe('8');
    expect(borderSideAttrs(cellAfterColor, 'left')).toEqual(foreignLeftBefore);

    await pickMenuAsync(view, 'table.borderStyle', 1);
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    revision++;
    const cellAfterStyle = firstCell(editor());
    expect(borderSideAttrs(cellAfterStyle, 'top').val).toBe('dashed');
    expect(borderSideAttrs(cellAfterStyle, 'top').color?.toUpperCase()).toBe('336699');
    expect(borderSideAttrs(cellAfterStyle, 'top').sz).toBe('8');
    expect(borderSideAttrs(cellAfterStyle, 'left')).toEqual(foreignLeftBefore);

    await pickMenuAsync(view, 'table.borderWidth', 2);
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    revision++;
    const cellAfterWidth = firstCell(editor());
    expect(borderSideAttrs(cellAfterWidth, 'top').sz).toBe('12');
    expect(borderSideAttrs(cellAfterWidth, 'top').val).toBe('dashed');
    expect(borderSideAttrs(cellAfterWidth, 'top').color?.toUpperCase()).toBe('336699');
    expect(borderSideAttrs(cellAfterWidth, 'left')).toEqual(foreignLeftBefore);

    await pickTargetAsync(view, 'none');
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    const cellAfterNone = firstCell(editor());
    expect(borderSideAttrs(cellAfterNone, 'top').val).toBe('none');
    expect(borderSideAttrs(cellAfterNone, 'top').sz).toBeUndefined();
    expect(borderSideAttrs(cellAfterNone, 'top').color).toBeUndefined();
    expect(borderSideAttrs(cellAfterNone, 'left')).toEqual(foreignLeftBefore);
    expect(shdAttrs(documentPart(editor()), cellId)).toEqual(foreignShdBefore);

    await pickFillAsync(view, 'FFFF00');
    expect(shdFill(documentPart(editor()), cellId)?.toUpperCase()).toBe('FFFF00');
    expect(shdAttrs(documentPart(editor()), cellId).val).toBe('pct10');
    expect(shdAttrs(documentPart(editor()), cellId).color).toBe('222222');
    await clearFillAsync(view);
    expect(shdFill(documentPart(editor()), cellId)).toBeUndefined();
    expect(shdAttrs(documentPart(editor()), cellId)).toEqual(foreignShdBefore);
    expect(readDraftTarget(view)).not.toBeNull();
  });

  test('seven context rows: one revision, selection, focus, undo per row', async () => {
    const cases: Array<{
      slot: string;
      source: Uint8Array;
      paragraphIndex: number;
      rect?: boolean;
      rowsAfter: number;
      colsAfter: number;
      tablesAfter: number;
      expectedText: string;
    }> = [
      {
        slot: 'table.insertRowAbove',
        source: TABLE_2X2,
        paragraphIndex: 0,
        rowsAfter: 3,
        colsAfter: 2,
        tablesAfter: 1,
        expectedText: '',
      },
      {
        slot: 'table.insertRowBelow',
        source: TABLE_2X2,
        paragraphIndex: 0,
        rowsAfter: 3,
        colsAfter: 2,
        tablesAfter: 1,
        expectedText: '',
      },
      {
        slot: 'table.insertColumnLeft',
        source: TABLE_2X2,
        paragraphIndex: 0,
        rowsAfter: 2,
        colsAfter: 3,
        tablesAfter: 1,
        expectedText: '',
      },
      {
        slot: 'table.insertColumnRight',
        source: TABLE_2X2,
        paragraphIndex: 0,
        rowsAfter: 2,
        colsAfter: 3,
        tablesAfter: 1,
        expectedText: '',
      },
      {
        slot: 'table.deleteRow',
        source: TABLE_2X2,
        paragraphIndex: 0,
        rowsAfter: 1,
        colsAfter: 2,
        tablesAfter: 1,
        expectedText: 'A2',
      },
      {
        slot: 'table.deleteColumn',
        source: TABLE_2X2,
        paragraphIndex: 0,
        rowsAfter: 2,
        colsAfter: 1,
        tablesAfter: 1,
        expectedText: 'B1',
      },
      {
        slot: 'table.deleteTable',
        source: TABLE_WITH_LEAD,
        paragraphIndex: 1,
        rowsAfter: 0,
        colsAfter: 0,
        tablesAfter: 0,
        expectedText: 'lead',
      },
    ];

    for (const rowCase of cases) {
      const { view, editor, unmount } = mount(undefined, rowCase.source);
      await waitReady(editor);
      const pages = pagesEl(view);
      pages.focus();
      if (rowCase.rect) selectCellRect(editor(), 0, 0, 1, 1);
      else caretInCell(editor(), rowCase.paragraphIndex);
      const surface = editor().surface!;
      const partBefore = documentPart(editor());
      const rowsBefore = collectByKind(partBefore.root, 'tableRow').length;
      const colsBefore = tableColumnCount(partBefore);
      const tablesBefore = collectByKind(partBefore.root, 'table').length;
      const revisionBefore = surface.session.revision();
      const selectionBefore = surface.state().selection;
      const rectBefore = surface.state().cellSelection?.cellIds ?? null;
      const activeBefore = document.activeElement;
      rightClick(view);
      const row = rowNamed(view, rowCase.slot);
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      act(() => {
        row.dispatchEvent(down);
      });
      expect(down.defaultPrevented).toBe(true);
      expect(surface.state().selection).toEqual(selectionBefore);
      expect(surface.state().cellSelection?.cellIds ?? null).toEqual(rectBefore);
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
      expect(selectionText(editor())).toBe(rowCase.expectedText);
      expect(panel(view)).toBeNull();
      expect(document.activeElement).toBe(pages);
      await act(async () => {
        editor().exec({ type: 'undo' });
      });
      const partUndo = documentPart(editor());
      expect(collectByKind(partUndo.root, 'tableRow').length).toBe(rowsBefore);
      expect(tableColumnCount(partUndo)).toBe(colsBefore);
      expect(collectByKind(partUndo.root, 'table').length).toBe(tablesBefore);
      await act(async () => {
        editor().exec({ type: 'redo' });
      });
      expect(selectionText(editor())).toBe(rowCase.expectedText);
      unmount();
    }
  });

  test('merged column insert refusal keeps menu open', async () => {
    const { view, editor, unmount } = mount(undefined, MERGED_TABLE);
    await waitReady(editor);
    caretInCell(editor());
    const pages = pagesEl(view);
    pages.focus();
    const revisionBefore = editor().surface!.session.revision();
    rightClick(view);
    const row = rowNamed(view, 'table.insertColumnRight');
    expect(row.getAttribute('title')).toBe('this table has merged cells');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(editor().surface!.session.revision()).toBe(revisionBefore);
    expect(panel(view)).not.toBeNull();
    unmount();
  });

  test('final row and column delete refusals keep menu open', async () => {
    for (const [source, slot] of [
      [ONE_ROW_TABLE, 'table.deleteRow'],
      [ONE_COL_TABLE, 'table.deleteColumn'],
    ] as const) {
      const { view, editor, unmount } = mount(undefined, source);
      await waitReady(editor);
      caretInCell(editor());
      const revisionBefore = editor().surface!.session.revision();
      rightClick(view);
      const row = rowNamed(view, slot);
      expect(row.getAttribute('title')).toBe('the table must keep at least one row or column');
      await act(async () => {
        fireEvent.click(row);
      });
      expect(editor().surface!.session.revision()).toBe(revisionBefore);
      expect(panel(view)).not.toBeNull();
      unmount();
    }
  });

  test('viewing mode refusal keeps menu open', async () => {
    const { view, editor, unmount } = mount(undefined, TABLE_2X2);
    await waitReady(editor);
    caretInCell(editor());
    const pages = pagesEl(view);
    pages.focus();
    const revisionBefore = editor().surface!.session.revision();
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
    expect(panel(view)).not.toBeNull();
    unmount();
  });

  test('resource limit refusal shows engine reason without mutation', async () => {
    const { view, editor, unmount } = mount(undefined, TABLE_2X2);
    await waitReady(editor);
    caretInCell(editor());
    const pages = pagesEl(view);
    pages.focus();
    const ed = editor();
    const origCan = ed.can.bind(ed);
    ed.can = (cmd) => {
      if (typeof cmd === 'object' && cmd.type === 'insertColumn' && cmd.where === 'right') {
        return { ok: false, reason: 'the table has reached the supported size limit' };
      }
      return origCan(cmd);
    };
    const revisionBefore = ed.surface!.session.revision();
    rightClick(view);
    const row = rowNamed(view, 'table.insertColumnRight');
    expect(row.getAttribute('title')).toBe('the table has reached the supported size limit');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(panel(view)).not.toBeNull();
    expect(ed.surface!.session.revision()).toBe(revisionBefore);
    expect(document.activeElement).toBe(pages);
    unmount();
  });

  test('table provider subscription count and cleanup', async () => {
    expect(tableChromeProviderSubscriptionCount()).toBe(0);
    const baseline = editorStateActiveSubscriptionCount();
    const { unmount: u1, editor: editor1 } = mount(<DocxEditorToolbar />);
    await waitReady(editor1);
    expect(tableChromeProviderSubscriptionCount()).toBe(1);
    expect(editorStateActiveSubscriptionCount()).toBeGreaterThan(baseline);
    u1();
    await act(async () => {});
    expect(tableChromeProviderSubscriptionCount()).toBe(0);

    const { unmount: u2, editor: editor2 } = mount(
      <DocxEditorToolbar preset={false}>
        <>
          <DocxEditorToolbar.TableBorderTarget />
          <DocxEditorToolbar.TableBorderColor />
        </>
      </DocxEditorToolbar>
    );
    await waitReady(editor2);
    expect(tableChromeProviderSubscriptionCount()).toBe(1);
    u2();
    await act(async () => {});

    const { editor: editor3 } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold />
      </DocxEditorToolbar>
    );
    await waitReady(editor3);
    expect(tableChromeProviderSubscriptionCount()).toBe(0);
  });

  test('unrelated bold does not re-derive table slot states', async () => {
    const { view, editor } = mount(<DocxEditorToolbar />);
    await waitReady(editor);
    resetTableChromeStateDerivationCount();
    await act(async () => {
      caretInCell(editor());
    });
    const derivationsAfterMount = tableChromeStateDerivationCount();
    const targetNode = view.container.querySelector('[data-slot="table.borderTarget"]');
    await act(async () => {
      editor().exec({ type: 'toggleMark', mark: 'bold' });
    });
    expect(tableChromeStateDerivationCount()).toBe(derivationsAfterMount);
    expect(view.container.querySelector('[data-slot="table.borderTarget"]')).toBe(targetNode);
    await act(async () => {
      const paragraphId = editor().surface!.session.paragraphIds()[1]!;
      editor().surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 1 },
      });
    });
    expect(tableChromeStateDerivationCount()).toBeGreaterThan(derivationsAfterMount);
  });

  test('target menu keyboard matrix (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
      </DocxEditorToolbar>
    );
    await waitReady(editor);
    await act(async () => {
      caretInCell(editor());
    });
    const root = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    const menu = root.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'Home' });
    fireEvent.keyDown(menu, { key: 'End' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(root.querySelector('[role="menu"]')).toBeNull();
    await act(async () => {
      trigger.click();
    });
    const menu2 = root.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu2, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  test('style and width menu keyboard matrix (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderStyle />
        <DocxEditorToolbar.TableBorderWidth />
      </DocxEditorToolbar>
    );
    await waitReady(editor);
    await act(async () => {
      caretInCell(editor());
    });
    await pickTargetAsync(view, 'top');
    for (const slot of ['table.borderStyle', 'table.borderWidth'] as const) {
      const root = view.container.querySelector(`[data-slot="${slot}"]`)!;
      const trigger = root.querySelector('button') as HTMLButtonElement;
      await act(async () => {
        trigger.click();
      });
      const menu = root.querySelector('[role="menu"]') as HTMLElement;
      expect(menu.contains(document.activeElement)).toBe(true);
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

  test('border-color and cell-fill dialog keyboard matrix (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderColor />
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>
    );
    await waitReady(editor);
    await act(async () => {
      caretInCell(editor());
    });
    await pickTargetAsync(view, 'top');
    for (const slot of ['table.borderColor', 'table.cellFill'] as const) {
      const root = view.container.querySelector(`[data-slot="${slot}"]`)!;
      const trigger = root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
      await act(async () => {
        trigger.click();
      });
      const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(root.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    }
  });

  test('custom asChild triggers keep menu keyboard semantics (retroactive)', async () => {
    const CustomTrigger = forwardRef<HTMLButtonElement, { onClick?: () => void }>((props, ref) => (
      <button type="button" ref={ref} data-testid="custom-trigger" {...props}>
        open
      </button>
    ));
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget>
          <DocxEditorToolbar.TableBorderTarget.Trigger asChild>
            <CustomTrigger />
          </DocxEditorToolbar.TableBorderTarget.Trigger>
          <DocxEditorToolbar.TableBorderTarget.Content />
        </DocxEditorToolbar.TableBorderTarget>
      </DocxEditorToolbar>
    );
    await waitReady(editor);
    await act(async () => {
      caretInCell(editor());
    });
    const trigger = view.getByTestId('custom-trigger');
    await act(async () => {
      trigger.click();
    });
    const menu = view.container.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(view.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
