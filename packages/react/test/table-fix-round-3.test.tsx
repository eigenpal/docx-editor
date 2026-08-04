// Task 10 fix round 3 — execute semantics, Fragment provider, persisted OOXML,
// context matrix, locale column, subscriptions, keyboard (retroactive where noted).

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
import { TableChromeProvider, tableChromeProviderMountCount } from '../src/editor/toolbar/useTableChrome.tsx';
import { editorStateActiveSubscriptionCount } from '../src/editor/useEditorState.ts';

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

const TABLE_WITH_LEFT_BORDER = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:tcBorders><w:left w:val="single" w:sz="8" w:color="00AA00"/></w:tcBorders></w:tcPr>${p('A1')}</w:tc>${tc(p('B1'))}</w:tr>` +
    `<w:tr>${tc(p('A2'))}${tc(p('B2'))}</w:tr></w:tbl>`
);

const TABLE_WITH_SHD_PAYLOAD = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:shd w:val="pct10" w:color="222222"/></w:tcPr>${p('A1')}</w:tc>${tc(p('B1'))}</w:tr>` +
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

function shdFill(part: OoxmlPart, cellId: string): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChild(cell, 'tcPr');
  const shd = tcPr && wmlChild(tcPr, 'shd');
  return shd?.attributes.find((a) => a.localName === 'fill')?.value;
}

function shdAttr(part: OoxmlPart, cellId: string, localName: string): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((c) => c.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChild(cell, 'tcPr');
  const shd = tcPr && wmlChild(tcPr, 'shd');
  return shd?.attributes.find((a) => a.localName === localName)?.value;
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
      <DocxEditorViewport>
        <DocxEditorContent />
        {toolbar}
        <ContextMenu t={(key) => key} />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
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

function documentPart(editor: DocxEditorInstance): OoxmlPart {
  return editor.surface!.session.part();
}

function firstCell(editor: DocxEditorInstance): OoxmlElement {
  return collectByKind(documentPart(editor).root, 'tableCell')[0]!;
}

function stubPagesRect(pages: HTMLElement): void {
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 100,
      top: 50,
      right: 1100,
      bottom: 1050,
      width: 1000,
      height: 1000,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    }),
  });
}

function pointerAtPageContent(
  editor: DocxEditorInstance,
  pages: HTMLElement,
  contentX: number,
  contentY: number
): PointerEvent {
  const layout = editor.surface!.layout();
  const page = layout.pages[0]!;
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
  const pages = view.container.querySelector('.docx-pages') as HTMLElement;
  stubPagesRect(pages);
  pages.focus();
  pages.dispatchEvent(pointerAtPageContent(editor, pages, table.box.x + 4, rowMidY));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 220));
  });
  pages.dispatchEvent(pointerAtPageContent(editor, pages, table.box.x + 4, rowMidY));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  const btn = view.container.querySelector<HTMLButtonElement>('.docx-table-insert-row');
  if (!btn) throw new Error('insert row control missing');
  return btn;
}

async function revealInsertColumn(view: ReturnType<typeof render>, editor: DocxEditorInstance): Promise<HTMLButtonElement> {
  const layout = editor.surface!.layout();
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('table missing');
  const cell = table.rows[0]!.cells[0]!;
  const left = table.columnEdges[cell.gridColumn] ?? 0;
  const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
  const colX = table.box.x + (left + right) / 2;
  const colY = table.box.y - 6;
  const pages = view.container.querySelector('.docx-pages') as HTMLElement;
  stubPagesRect(pages);
  pages.focus();
  pages.dispatchEvent(pointerAtPageContent(editor, pages, colX, colY));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 220));
  });
  pages.dispatchEvent(pointerAtPageContent(editor, pages, colX, colY));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  const btn = view.container.querySelector<HTMLButtonElement>('.docx-table-insert-column');
  if (!btn) throw new Error('insert column control missing');
  return btn;
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

function pickTarget(view: ReturnType<typeof render>, value: string): void {
  const root = view.container.querySelector('[data-slot="table.borderTarget"]')!;
  act(() => {
    (root.querySelector('button') as HTMLButtonElement).click();
  });
  const item = root.querySelector(`[data-value="${value}"]`) as HTMLButtonElement | null;
  if (!item) throw new Error(`border target option missing: ${value}`);
  act(() => {
    item.click();
  });
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
    if (!item) throw new Error(`border target option missing: ${value}`);
    item.click();
  });
}

async function pickMenuAsync(view: ReturnType<typeof render>, slot: string, index = 0): Promise<void> {
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
    const swatch = root.querySelector(`[data-value="${hex}"]`) as HTMLButtonElement | null;
    if (swatch) {
      swatch.click();
      return;
    }
    const hexInput = root.querySelector('.docx-toolbar__swatch-hex') as HTMLInputElement | null;
    const apply = root.querySelector('.docx-toolbar__swatch-apply') as HTMLButtonElement | null;
    if (!hexInput || !apply) throw new Error(`border color swatch missing: ${hex}`);
    fireEvent.change(hexInput, { target: { value: hex } });
    apply.click();
  });
}

async function pickFillAsync(view: ReturnType<typeof render>, hex: string): Promise<void> {
  const root = view.container.querySelector('[data-slot="table.cellFill"]')!;
  await act(async () => {
    (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
  });
  await act(async () => {
    const swatch = root.querySelector(`[data-value="${hex}"]`) as HTMLButtonElement | null;
    if (swatch) {
      swatch.click();
      return;
    }
    const hexInput = root.querySelector('.docx-toolbar__swatch-hex') as HTMLInputElement | null;
    const apply = root.querySelector('.docx-toolbar__swatch-apply') as HTMLButtonElement | null;
    if (!hexInput || !apply) throw new Error(`fill swatch missing: ${hex}`);
    fireEvent.change(hexInput, { target: { value: hex } });
    apply.click();
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

function pickMenu(view: ReturnType<typeof render>, slot: string, index = 0): void {
  const root = view.container.querySelector(`[data-slot="${slot}"]`)!;
  act(() => {
    (root.querySelector('button') as HTMLButtonElement).click();
  });
  act(() => {
    (root.querySelectorAll('[role="menuitemradio"]')[index] as HTMLButtonElement).click();
  });
}

function pickColor(view: ReturnType<typeof render>, hex: string): void {
  const root = view.container.querySelector('[data-slot="table.borderColor"]')!;
  act(() => {
    (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
  });
  act(() => {
    const swatch = root.querySelector(`[data-value="${hex}"]`) as HTMLButtonElement | null;
    if (swatch) {
      swatch.click();
      return;
    }
    const hexInput = root.querySelector('.docx-toolbar__swatch-hex') as HTMLInputElement | null;
    const apply = root.querySelector('.docx-toolbar__swatch-apply') as HTMLButtonElement | null;
    if (!hexInput || !apply) throw new Error(`border color swatch missing: ${hex}`);
    fireEvent.change(hexInput, { target: { value: hex } });
    apply.click();
  });
}

function pickFill(view: ReturnType<typeof render>, hex: string): void {
  const root = view.container.querySelector('[data-slot="table.cellFill"]')!;
  act(() => {
    (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
  });
  act(() => {
    const swatch = root.querySelector(`[data-value="${hex}"]`) as HTMLButtonElement | null;
    if (swatch) {
      swatch.click();
      return;
    }
    const hexInput = root.querySelector('.docx-toolbar__swatch-hex') as HTMLInputElement | null;
    const apply = root.querySelector('.docx-toolbar__swatch-apply') as HTMLButtonElement | null;
    if (!hexInput || !apply) throw new Error(`fill swatch missing: ${hex}`);
    fireEvent.change(hexInput, { target: { value: hex } });
    apply.click();
  });
}

function clearFill(view: ReturnType<typeof render>): void {
  const root = view.container.querySelector('[data-slot="table.cellFill"]')!;
  act(() => {
    (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
  });
  act(() => {
    (root.querySelector('.docx-toolbar__swatch-clear') as HTMLButtonElement).click();
  });
}

afterEach(() => cleanup());

describe('Task 10 fix round 3', () => {
  test('context menu stays open when exec fails after enabled row click', async () => {
    const { view, editor } = mount(undefined, TABLE_2X2);
    caretInFirstCell(editor());
    rightClick(view);
    const ed = editor();
    ed.exec = () => ({ ok: false, reason: 'stale admission' });
    const row = rowNamed(view, 'table.insertRowBelow');
    expect(row.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(panel(view)).not.toBeNull();
    expect(ed.surface!.session.revision()).toBe(0);
  });

  test('multi-child Fragment with two table parts mounts one provider and shares draft', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <>
          <DocxEditorToolbar.TableBorderTarget />
          <DocxEditorToolbar.TableBorderColor />
        </>
      </DocxEditorToolbar>
    );
    await act(async () => {});
    expect(tableChromeProviderMountCount()).toBe(1);
    await act(async () => {
      caretInFirstCell(editor());
    });
    await pickTargetAsync(view, 'top');
    await pickColorAsync(view, '336699');
    expect(
      borderSideAttrs(firstCell(editor()), 'top').color?.toUpperCase()
    ).toBe('336699');
  });

  test('nested Fragment with five table parts does not throw', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <>
          <>
            <DocxEditorToolbar.TableBorderTarget />
            <DocxEditorToolbar.TableBorderColor />
          </>
          <>
            <DocxEditorToolbar.TableBorderStyle />
            <DocxEditorToolbar.TableBorderWidth />
            <DocxEditorToolbar.TableCellFill />
          </>
        </>
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    expect(tableChromeProviderMountCount()).toBe(1);
    expect(view.container.querySelector('[data-slot="table.borderTarget"]')).not.toBeNull();
    expect(view.container.querySelector('[data-slot="table.cellFill"]')).not.toBeNull();
  });

  test('Fragment without table parts omits TableChromeProvider', async () => {
    mount(
      <DocxEditorToolbar preset={false}>
        <>
          <DocxEditorToolbar.Bold />
          <DocxEditorToolbar.Italic />
        </>
      </DocxEditorToolbar>
    );
    await act(async () => {});
    expect(tableChromeProviderMountCount()).toBe(0);
  });

  test('React persisted matrix preserves foreign border and shd payload', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderColor />
        <DocxEditorToolbar.TableBorderStyle />
        <DocxEditorToolbar.TableBorderWidth />
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>,
      TABLE_WITH_LEFT_BORDER
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    let revision = editor().surface!.session.revision();

    await pickTargetAsync(view, 'top');
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    revision++;

    await pickColorAsync(view, '336699');
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    const cellAfterColor = firstCell(editor());
    expect(borderSideAttrs(cellAfterColor, 'top').color?.toUpperCase()).toBe('336699');
    expect(borderSideAttrs(cellAfterColor, 'left').color?.toUpperCase()).toBe('00AA00');
    revision++;

    await pickMenuAsync(view, 'table.borderStyle', 1);
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    expect(borderSideAttrs(firstCell(editor()), 'top').val).not.toBe('single');
    revision++;

    await pickMenuAsync(view, 'table.borderWidth', 2);
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    revision++;

    await pickTargetAsync(view, 'none');
    expect(editor().surface!.session.revision()).toBe(revision + 1);
    const cellAfterNone = firstCell(editor());
    expect(borderSideAttrs(cellAfterNone, 'top').val).toBe('none');
    expect(borderSideAttrs(cellAfterNone, 'left').val).toBe('single');
  });

  test('React fill pick and clear preserves unrelated shd payload', async () => {
    const shdDoc = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>,
      TABLE_WITH_SHD_PAYLOAD
    );
    await act(async () => {
      caretInFirstCell(shdDoc.editor());
    });
    const shdCell = firstCell(shdDoc.editor());
    let shdRevision = shdDoc.editor().surface!.session.revision();
    await pickFillAsync(shdDoc.view, 'FFFF00');
    expect(shdDoc.editor().surface!.session.revision()).toBe(shdRevision + 1);
    expect(shdFill(documentPart(shdDoc.editor()), shdCell.id)?.toUpperCase()).toBe('FFFF00');
    shdRevision++;
    await clearFillAsync(shdDoc.view);
    expect(shdDoc.editor().surface!.session.revision()).toBe(shdRevision + 1);
    expect(shdFill(documentPart(shdDoc.editor()), shdCell.id)).toBeUndefined();
    expect(shdAttr(documentPart(shdDoc.editor()), shdCell.id, 'val')).toBe('pct10');
    expect(shdAttr(documentPart(shdDoc.editor()), shdCell.id, 'color')).toBe('222222');
  });

  test('visible retained column label updates on locale change', async () => {
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
    await act(async () => {});
    caretInFirstCell(editorRef!);
    const editorBefore = editorRef;
    const layoutRevisionBefore = editorRef!.surface!.layout().revision;
    const control = await revealInsertColumn(view, editorRef!);
    expect(control.getAttribute('aria-label')).toBe('EN-table.insertColumnRight');
    await act(async () => {
      fireEvent.click(view.getByTestId('switch-locale'));
    });
    expect(editorRef).toBe(editorBefore);
    expect(editorRef!.surface!.layout().revision).toBe(layoutRevisionBefore);
    expect(control.getAttribute('aria-label')).toBe('PL-table.insertColumnRight');
    expect(view.container.querySelectorAll('.docx-table-insert-column, .docx-table-insert-row').length).toBe(1);
  });

  test('table chrome provider uses one useEditorState subscription for five parts', async () => {
    let instance: DocxEditorInstance | null = null;
    render(
      <DocxEditorRoot
        document={TABLE_2X2}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <TableChromeProvider>
            <>
              <DocxEditorToolbar.TableBorderTarget />
              <DocxEditorToolbar.TableBorderColor />
              <DocxEditorToolbar.TableBorderStyle />
              <DocxEditorToolbar.TableBorderWidth />
              <DocxEditorToolbar.TableCellFill />
            </>
          </TableChromeProvider>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await act(async () => {});
    expect(tableChromeProviderMountCount()).toBe(1);
    await act(async () => {
      caretInFirstCell(instance!);
    });
  });

  test('bold-only preset toolbar adds no table provider mount', async () => {
    mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold />
      </DocxEditorToolbar>
    );
    await act(async () => {});
    expect(tableChromeProviderMountCount()).toBe(0);
  });

  test('default toolbar mounts one TableChromeProvider', async () => {
    const { editor } = mount(<DocxEditorToolbar />);
    await act(async () => {
      caretInFirstCell(editor());
    });
    expect(tableChromeProviderMountCount()).toBe(1);
  });

  test('unrelated bold toggle keeps table target node stable', async () => {
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

  test('context row mousedown keeps selection until activation', async () => {
    const { view, editor } = mount(undefined, TABLE_2X2);
    act(() => {
      const paragraphId = editor().surface!.session.paragraphIds()[0]!;
      editor().surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 2 },
      });
    });
    const selectionBefore = editor().surface!.state().selection;
    const textBefore = editor().query({ type: 'selectedText' });
    rightClick(view);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      rowNamed(view, 'table.insertRowBelow').dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(editor().surface!.state().selection).toEqual(selectionBefore);
    expect(editor().query({ type: 'selectedText' })).toBe(textBefore);
  });

  test('insert row below accepted click bumps revision once and closes menu', async () => {
    const { view, editor } = mount(undefined, TABLE_2X2);
    caretInFirstCell(editor());
    const revisionBefore = editor().surface!.session.revision();
    rightClick(view);
    await act(async () => {
      fireEvent.click(rowNamed(view, 'table.insertRowBelow'));
    });
    expect(editor().surface!.session.revision()).toBe(revisionBefore + 1);
    expect(panel(view)).toBeNull();
  });

  test('final row delete refusal keeps menu open with exact reason', async () => {
    const { view, editor } = mount(undefined, ONE_ROW_TABLE);
    caretInFirstCell(editor());
    const revisionBefore = editor().surface!.session.revision();
    rightClick(view);
    const row = rowNamed(view, 'table.deleteRow');
    expect(row.getAttribute('title')).toBe('the table must keep at least one row or column');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(panel(view)).not.toBeNull();
    expect(editor().surface!.session.revision()).toBe(revisionBefore);
  });

  test('final column delete refusal keeps menu open with exact reason', async () => {
    const { view, editor } = mount(undefined, ONE_COL_TABLE);
    caretInFirstCell(editor());
    const revisionBefore = editor().surface!.session.revision();
    rightClick(view);
    const row = rowNamed(view, 'table.deleteColumn');
    expect(row.getAttribute('title')).toBe('the table must keep at least one row or column');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(panel(view)).not.toBeNull();
    expect(editor().surface!.session.revision()).toBe(revisionBefore);
  });

  test('merged table column insert refusal keeps menu open', async () => {
    const { view, editor } = mount(undefined, MERGED_TABLE);
    caretInFirstCell(editor());
    rightClick(view);
    const row = rowNamed(view, 'table.insertColumnRight');
    expect(row.getAttribute('title')).toBe('this table has merged cells');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(panel(view)).not.toBeNull();
  });

  test('viewing mode refusal keeps menu open with exact reason', async () => {
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

  test('delete table accepted on lead fixture closes menu', async () => {
    const { view, editor } = mount(undefined, TABLE_WITH_LEAD);
    caretInFirstCell(editor(), 1);
    rightClick(view);
    await act(async () => {
      fireEvent.click(rowNamed(view, 'table.deleteTable'));
    });
    expect(collectByKind(documentPart(editor()).root, 'table').length).toBe(0);
    expect(panel(view)).toBeNull();
  });

  test('style menu ArrowUp and Escape restore trigger focus (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderStyle />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const root = view.container.querySelector('[data-slot="table.borderStyle"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    const menu = root.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('width menu Space activates and Escape restores trigger focus (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderWidth />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    pickTarget(view, 'top');
    const root = view.container.querySelector('[data-slot="table.borderWidth"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    const menu = root.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: ' ' });
    expect(root.querySelector('[role="menu"]')).toBeNull();
    await act(async () => {
      trigger.click();
    });
    const menu2 = root.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu2, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  test('fill dialog initial focus and Escape restore (retroactive)', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const root = view.container.querySelector('[data-slot="table.cellFill"]')!;
    const trigger = root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('custom asChild trigger keeps keyboard menu semantics (retroactive)', async () => {
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
          <DocxEditorToolbar.TableBorderTarget.Content />
        </DocxEditorToolbar.TableBorderTarget>
      </DocxEditorToolbar>
    );
    await act(async () => {
      caretInFirstCell(editor());
    });
    const trigger = view.getByTestId('custom-trigger');
    await act(async () => {
      trigger.click();
    });
    const menu = view.container.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(view.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
