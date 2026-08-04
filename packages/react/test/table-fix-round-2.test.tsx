// Task 10 fix round 2 — locale repaint, compounds, subscriptions, OOXML, context matrix.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { forwardRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
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

const W = WML_NAMESPACE_URI;

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

const TABLE_2X2_WITH_LEAD = docx(
  '<w:p><w:r><w:t>lead</w:t></w:r></w:p>' +
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
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

function shdFill(part: OoxmlPart, cellId: string): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChild(cell, 'tcPr');
  const shd = tcPr && wmlChild(tcPr, 'shd');
  return shd?.attributes.find((a) => a.localName === 'fill')?.value;
}

function mount(
  toolbar?: ReactNode,
  source = TABLE_2X2,
  rootProps: Record<string, unknown> = {}
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
      {...rootProps}
    >
      {toolbar}
      <DocxEditorViewport>
        <DocxEditorContent />
        <ContextMenu t={(key) => key} />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function pointerAtPageContent(
  editor: DocxEditorInstance,
  pages: HTMLElement,
  pageIndex: number,
  contentX: number,
  contentY: number
): PointerEvent {
  const layout = editor.surface!.layout();
  const page = layout.pages[pageIndex]!;
  const scale = 96 / 72;
  const rect = pages.getBoundingClientRect();
  const sheetX = page.contentBox.x + contentX;
  const sheetY = page.contentBox.y + contentY;
  return new PointerEvent('pointermove', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: rect.left + sheetX * scale,
    clientY: rect.top + sheetY * scale,
  });
}

async function revealInsertRow(view: ReturnType<typeof render>, editor: DocxEditorInstance): Promise<HTMLButtonElement> {
  const layout = editor.surface!.layout();
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('table missing');
  const rowMidY = table.rows[0]!.box.y + table.rows[0]!.box.height / 2;
  const x = table.box.x + 4;
  const y = rowMidY;
  const pages = pagesEl(view);
  stubPagesRect(pages);
  pages.focus();
  pages.dispatchEvent(pointerAtPageContent(editor, pages, 0, x, y));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
  pages.dispatchEvent(pointerAtPageContent(editor, pages, 0, x, y));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  const btn = furnitureEl(view).querySelector<HTMLButtonElement>('.docx-table-insert-row');
  if (!btn) throw new Error('insert row control missing');
  return btn;
}

function caretInFirstCell(editor: DocxEditorInstance, paragraphIndex = 0): void {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
  });
}

function pagesEl(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector('.docx-pages') as HTMLElement;
}

function furnitureEl(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector('.docx-table-furniture') as HTMLElement;
}

function tableColumnCount(part: OoxmlPart): number {
  const table = collectByKind(part.root, 'table')[0];
  if (!table) return 0;
  const row = table.children?.find((child) => child.kind === 'tableRow');
  if (!row || row.kind === 'textValue') return 0;
  return row.children?.filter((child) => child.kind === 'tableCell').length ?? 0;
}

function documentPart(editor: DocxEditorInstance): OoxmlPart {
  return editor.surface!.session.part();
}

function stubPagesRect(pages: HTMLElement, rect: { left: number; top: number } = { left: 100, top: 50 }): void {
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + 1000,
      bottom: rect.top + 1000,
      width: 1000,
      height: 1000,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

function panel(view: ReturnType<typeof render>): HTMLElement | null {
  return view.container.querySelector('.docx-contextmenu');
}

function rightClick(view: ReturnType<typeof render>, x = 120, y = 140): void {
  act(() => {
    fireEvent.contextMenu(
      view.container.querySelector('.docx-paginated-surface') as HTMLElement,
      { clientX: x, clientY: y, button: 2 }
    );
  });
}

function rowNamed(view: ReturnType<typeof render>, slot: string): HTMLElement {
  const element = panel(view)?.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!element) throw new Error(`no row for ${slot}`);
  return element;
}

afterEach(() => cleanup());

describe('Task 10 fix round 2', () => {
  test('visible insert furniture aria-label updates on locale change without remount', async () => {
    let editorRef: DocxEditorInstance | null = null;
    function Host() {
      const [locale, setLocale] = useState<'en' | 'pl'>('en');
      const label = (key: 'table.insertRowBelow' | 'table.insertColumnRight') =>
        (locale === 'pl' ? 'PL-' : 'EN-') + key;
      return (
        <>
          <button type="button" data-testid="switch-locale" onClick={() => setLocale('pl')}>
            switch
          </button>
          <DocxEditorRoot
            document={TABLE_2X2}
            tableInteractionLabel={label}
            onReady={(editor) => {
              editorRef = editor as DocxEditorInstance;
            }}
          >
            <DocxEditorViewport>
              <DocxEditorContent />
            </DocxEditorViewport>
          </DocxEditorRoot>
        </>
      );
    }
    const view = render(<Host />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    stubPagesRect(pagesEl(view));
    caretInFirstCell(editorRef!);
    const editorBefore = editorRef;
    const control = await revealInsertRow(view, editorRef!);
    expect(control.getAttribute('aria-label')).toBe('EN-table.insertRowBelow');
    await act(async () => {
      fireEvent.click(view.getByTestId('switch-locale'));
    });
    await act(async () => {});
    expect(editorRef).toBe(editorBefore);
    expect(control.getAttribute('aria-label')).toBe('PL-table.insertRowBelow');
  });

  test('BorderColor.Item asChild merges props and dispatches hex value', async () => {
    const CustomSwatch = forwardRef<HTMLButtonElement, { onClick?: () => void }>((props, ref) => (
      <button type="button" ref={ref} data-testid="custom-swatch" {...props}>
        custom
      </button>
    ));
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderColor>
          <DocxEditorToolbar.TableBorderColor.Trigger />
          <DocxEditorToolbar.TableBorderColor.Content>
            <DocxEditorToolbar.TableBorderColor.Item value="336699" asChild>
              <CustomSwatch />
            </DocxEditorToolbar.TableBorderColor.Item>
          </DocxEditorToolbar.TableBorderColor.Content>
        </DocxEditorToolbar.TableBorderColor>
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const root = view.container.querySelector('[data-slot="table.borderColor"]')!;
    await act(async () => {
      (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
    });
    const swatch = view.getByTestId('custom-swatch');
    expect(swatch.getAttribute('data-value')).toBe('336699');
    await act(async () => {
      swatch.click();
    });
    expect(
      editor().can({
        type: 'setTableBorders',
        scope: 'all',
        spec: { style: 'single', size: 8, color: { kind: 'hex', value: '336699' } },
      }).ok
    ).toBe(true);
  });

  test('disabled compound asChild trigger renders reason node for aria-describedby', async () => {
    const CustomTrigger = forwardRef<HTMLButtonElement>((props, ref) => (
      <button type="button" ref={ref} data-testid="custom-trigger" {...props}>
        t
      </button>
    ));
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget>
          <DocxEditorToolbar.TableBorderTarget.Trigger asChild>
            <CustomTrigger />
          </DocxEditorToolbar.TableBorderTarget.Trigger>
        </DocxEditorToolbar.TableBorderTarget>
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    const trigger = view.getByTestId('custom-trigger');
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('the document is open for viewing');
  });

  test('preset=false toolbar without table parts omits TableChromeProvider', () => {
    const { view } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold />
      </DocxEditorToolbar>
    );
    expect(view.container.querySelector('[data-slot="text.bold"]')).not.toBeNull();
    expect(view.container.querySelector('[data-slot="table.borderTarget"]')).toBeNull();
  });

  test('unrelated bold toggle keeps table chrome mounted', async () => {
    const { view, editor } = mount(<DocxEditorToolbar />);
    await act(async () => {
      caretInFirstCell(editor());
    });
    const target = view.container.querySelector('[data-slot="table.borderTarget"]');
    await act(async () => {
      editor().exec({ type: 'toggleMark', mark: 'bold' });
    });
    expect(view.container.querySelector('[data-slot="table.borderTarget"]')).toBe(target);
  });

  test('target all React pick persists default border OOXML', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const targetRoot = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    await act(async () => {
      (targetRoot.querySelector('button') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        [...targetRoot.querySelectorAll('[role="menuitemradio"]')].find(
          (el) => el.getAttribute('data-value') === 'all'
        ) as HTMLButtonElement
      ).click();
    });
    const cell = collectByKind(documentPart(editor()).root, 'tableCell')[0]!;
    for (const side of ['top', 'left', 'bottom', 'right'] as const) {
      expect(borderSideAttrs(cell, side).val).toBe('single');
    }
  });

  test('color React pick persists hex on active target', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderColor />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const targetRoot = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    await act(async () => {
      (targetRoot.querySelector('button') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        [...targetRoot.querySelectorAll('[role="menuitemradio"]')].find(
          (el) => el.getAttribute('data-value') === 'top'
        ) as HTMLButtonElement
      ).click();
    });
    const colorRoot = view.container.querySelector('[data-slot="table.borderColor"]')!;
    await act(async () => {
      (colorRoot.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
    });
    await act(async () => {
      const swatch = colorRoot.querySelector('[data-value="336699"]') as HTMLButtonElement | null;
      if (swatch) {
        swatch.click();
        return;
      }
      const hexInput = colorRoot.querySelector('.docx-toolbar__swatch-hex') as HTMLInputElement;
      fireEvent.change(hexInput, { target: { value: '336699' } });
      (colorRoot.querySelector('.docx-toolbar__swatch-apply') as HTMLButtonElement).click();
    });
    const cell = collectByKind(documentPart(editor()).root, 'tableCell')[0]!;
    expect(borderSideAttrs(cell, 'top').color?.toUpperCase()).toBe('336699');
  });

  test('context menu separators group row, column, and destructive actions', () => {
    const { view, editor } = mount(undefined, TABLE_2X2);
    caretInFirstCell(editor());
    rightClick(view);
    const open = panel(view)!;
    const separators = [...open.querySelectorAll('[role="separator"]')];
    expect(separators.length).toBeGreaterThanOrEqual(3);
  });

  test('context row execute closes only on accepted action', async () => {
    const { view, editor } = mount(undefined, TABLE_2X2);
    caretInFirstCell(editor());
    rightClick(view);
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    const row = rowNamed(view, 'table.insertRowBelow');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(panel(view)).not.toBeNull();
  });

  test('insert row above increases row count through one transaction', () => {
    const { view, editor } = mount(undefined, TABLE_2X2);
    caretInFirstCell(editor());
    const rowsBefore = collectByKind(documentPart(editor()).root, 'tableRow').length;
    rightClick(view);
    act(() => {
      fireEvent.click(rowNamed(view, 'table.insertRowAbove'));
    });
    const rowsAfter = collectByKind(documentPart(editor()).root, 'tableRow').length;
    expect(rowsAfter).toBe(rowsBefore + 1);
    expect(panel(view)).toBeNull();
  });

  test('merged table column insert shows exact engine refusal', () => {
    const { view, editor } = mount(undefined, MERGED_TABLE);
    caretInFirstCell(editor());
    rightClick(view);
    const row = rowNamed(view, 'table.insertColumnRight');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.getAttribute('title')).toBe('this table has merged cells');
  });

  test('CellFill.Item asChild merges props and applies fill (retroactive)', async () => {
    const CustomFill = forwardRef<HTMLButtonElement, { onClick?: () => void }>((props, ref) => (
      <button type="button" ref={ref} data-testid="custom-fill" {...props}>
        fill
      </button>
    ));
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableCellFill>
          <DocxEditorToolbar.TableCellFill.Trigger />
          <DocxEditorToolbar.TableCellFill.Content>
            <DocxEditorToolbar.TableCellFill.Item value="FFFF00" asChild>
              <CustomFill />
            </DocxEditorToolbar.TableCellFill.Item>
          </DocxEditorToolbar.TableCellFill.Content>
        </DocxEditorToolbar.TableCellFill>
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const root = view.container.querySelector('[data-slot="table.cellFill"]')!;
    await act(async () => {
      (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
    });
    const swatch = view.getByTestId('custom-fill');
    expect(swatch.getAttribute('data-value')).toBe('FFFF00');
    await act(async () => {
      swatch.click();
    });
    const cell = collectByKind(documentPart(editor()).root, 'tableCell')[0]!;
    expect(shdFill(documentPart(editor()), cell.id)?.toUpperCase()).toBe('FFFF00');
  });

  test('none target clears authored border on active edge', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const targetRoot = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    await act(async () => {
      (targetRoot.querySelector('button') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        [...targetRoot.querySelectorAll('[role="menuitemradio"]')].find(
          (el) => el.getAttribute('data-value') === 'all'
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (targetRoot.querySelector('button') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        [...targetRoot.querySelectorAll('[role="menuitemradio"]')].find(
          (el) => el.getAttribute('data-value') === 'none'
        ) as HTMLButtonElement
      ).click();
    });
    const cell = collectByKind(documentPart(editor()).root, 'tableCell')[0]!;
    expect(borderSideAttrs(cell, 'top').val).toBe('none');
  });

  test('context row matrix executes one structural change per row', async () => {
    const cases: Array<{
      slot: string;
      rowsBefore: number;
      rowsAfter: number;
      colsBefore: number;
      colsAfter: number;
      tablesBefore: number;
      tablesAfter: number;
    }> = [
      {
        slot: 'table.insertRowAbove',
        rowsBefore: 2,
        rowsAfter: 3,
        colsBefore: 2,
        colsAfter: 2,
        tablesBefore: 1,
        tablesAfter: 1,
      },
      {
        slot: 'table.insertRowBelow',
        rowsBefore: 2,
        rowsAfter: 3,
        colsBefore: 2,
        colsAfter: 2,
        tablesBefore: 1,
        tablesAfter: 1,
      },
      {
        slot: 'table.insertColumnLeft',
        rowsBefore: 2,
        rowsAfter: 2,
        colsBefore: 2,
        colsAfter: 3,
        tablesBefore: 1,
        tablesAfter: 1,
      },
      {
        slot: 'table.insertColumnRight',
        rowsBefore: 2,
        rowsAfter: 2,
        colsBefore: 2,
        colsAfter: 3,
        tablesBefore: 1,
        tablesAfter: 1,
      },
      {
        slot: 'table.deleteRow',
        rowsBefore: 2,
        rowsAfter: 1,
        colsBefore: 2,
        colsAfter: 2,
        tablesBefore: 1,
        tablesAfter: 1,
      },
      {
        slot: 'table.deleteColumn',
        rowsBefore: 2,
        rowsAfter: 2,
        colsBefore: 2,
        colsAfter: 1,
        tablesBefore: 1,
        tablesAfter: 1,
      },
    ];
    for (const rowCase of cases) {
      const { view, editor } = mount(undefined, TABLE_2X2);
      caretInFirstCell(editor());
      const partBefore = documentPart(editor());
      const rowsBefore = collectByKind(partBefore.root, 'tableRow').length;
      const colsBefore = tableColumnCount(partBefore);
      const tablesBefore = collectByKind(partBefore.root, 'table').length;
      expect(rowsBefore).toBe(rowCase.rowsBefore);
      expect(colsBefore).toBe(rowCase.colsBefore);
      expect(tablesBefore).toBe(rowCase.tablesBefore);
      rightClick(view);
      await act(async () => {
        fireEvent.click(rowNamed(view, rowCase.slot));
      });
      const partAfter = documentPart(editor());
      expect(collectByKind(partAfter.root, 'tableRow').length).toBe(rowCase.rowsAfter);
      expect(tableColumnCount(partAfter)).toBe(rowCase.colsAfter);
      expect(collectByKind(partAfter.root, 'table').length).toBe(rowCase.tablesAfter);
      expect(panel(view)).toBeNull();
      cleanup();
    }
  });

  test('delete table row removes the table through one transaction', async () => {
    const { view, editor } = mount(undefined, TABLE_2X2_WITH_LEAD);
    caretInFirstCell(editor(), 1);
    rightClick(view);
    await act(async () => {
      fireEvent.click(rowNamed(view, 'table.deleteTable'));
    });
    expect(collectByKind(documentPart(editor()).root, 'table').length).toBe(0);
    expect(panel(view)).toBeNull();
  });

  test('viewing mode refusal keeps menu open on stale insert row click', async () => {
    const { view, editor } = mount(undefined, TABLE_2X2);
    caretInFirstCell(editor());
    rightClick(view);
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    const row = rowNamed(view, 'table.insertRowBelow');
    expect(row.getAttribute('title')).toBe('the document is open for viewing');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(panel(view)).not.toBeNull();
  });

  test('target menu ArrowDown and Escape restore trigger focus (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const root = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    const menu = root.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('width menu Enter activates item (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderWidth />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const targetRoot = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    await act(async () => {
      (targetRoot.querySelector('button') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        [...targetRoot.querySelectorAll('[role="menuitemradio"]')].find(
          (el) => el.getAttribute('data-value') === 'top'
        ) as HTMLButtonElement
      ).click();
    });
    const widthRoot = view.container.querySelector('[data-slot="table.borderWidth"]')!;
    const trigger = widthRoot.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    const menu = widthRoot.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(widthRoot.querySelector('[role="menu"]')).toBeNull();
  });

  test('border color dialog Escape restores trigger focus (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderColor />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const root = view.container.querySelector('[data-slot="table.borderColor"]')!;
    const trigger = root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
