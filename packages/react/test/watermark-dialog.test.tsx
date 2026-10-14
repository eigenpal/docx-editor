// DocxEditor.WatermarkDialog against the REAL engine: the Insert menu opens it, the form
// seeds from the document's watermark, Apply writes ONE setWatermark command (single undo
// step), No watermark removes it, and Cancel writes nothing.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';
import { DocxEditorWatermarkDialog } from '../src/editor/DocxEditorWatermark.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function mount(children: ReactNode): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {children}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

async function click(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function change(element: Element, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}

afterEach(() => {
  cleanup();
});

describe('DocxEditor.WatermarkDialog', () => {
  test('the Insert menu opens the dialog, and Apply sets a text watermark in one undo step', async () => {
    const { view, editor } = mount(<DocxEditorMenu />);
    await settle();
    const trigger = [
      ...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger'),
    ].find((button) => button.textContent === 'Insert')!;
    await click(trigger);
    const row = view.container.querySelector<HTMLElement>('[data-slot="insert.watermark"]')!;
    expect(row.getAttribute('aria-disabled')).not.toBe('true');
    await click(row);
    const dialog = view.getByRole('dialog', { name: 'Watermark' });
    expect(dialog.getAttribute('data-docx-dialog')).toBe('watermark');

    // No watermark yet: the first choice is selected and the text controls are disabled.
    expect((view.getByLabelText('No watermark') as HTMLInputElement).checked).toBe(true);
    expect((view.getByLabelText('Text') as HTMLInputElement).disabled).toBe(true);

    await click(view.getByLabelText('Text watermark'));
    expect((view.getByLabelText('Text') as HTMLInputElement).disabled).toBe(false);
    await change(view.getByLabelText('Text'), 'CONFIDENTIAL');
    await change(view.getByLabelText('Size'), '72');
    await click(view.getByLabelText('Bold'));
    await change(view.getAllByLabelText('Transparency')[0]!, '25');
    await change(view.getByLabelText('Color'), '#ff0000');
    await click(view.getByLabelText('Horizontal'));
    await click(view.getByText('Apply'));

    expect(view.queryByRole('dialog', { name: 'Watermark' })).toBeNull();
    expect(editor().getWatermark()).toMatchObject({
      kind: 'text',
      text: 'CONFIDENTIAL',
      fontSizePt: 72,
      bold: true,
      italic: false,
      color: 'FF0000',
      layout: 'horizontal',
    });
    expect(editor().getWatermark()!.transparency).toBeCloseTo(0.25, 2);

    await act(async () => {
      editor().exec({ type: 'undo' });
    });
    expect(editor().getWatermark()).toBeNull();
  });

  test('seeds from the existing watermark, and No watermark removes it', async () => {
    const { view, editor } = mount(null);
    await settle();
    await act(async () => {
      editor().exec({
        type: 'setWatermark',
        watermark: { text: 'SAMPLE', italic: true, layout: 'horizontal', fontSizePt: 54 },
      });
    });
    let closed = false;
    view.rerender(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorWatermarkDialog open onClose={() => (closed = true)} />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await settle();
    expect((view.getByLabelText('Text watermark') as HTMLInputElement).checked).toBe(true);
    expect((view.getByLabelText('Text') as HTMLInputElement).value).toBe('SAMPLE');
    expect((view.getByLabelText('Italic') as HTMLInputElement).checked).toBe(true);
    expect((view.getByLabelText('Size') as HTMLSelectElement).value).toBe('54');
    expect((view.getByLabelText('Horizontal') as HTMLInputElement).checked).toBe(true);

    await click(view.getByLabelText('No watermark'));
    await click(view.getByText('Apply'));
    expect(closed).toBe(true);
    expect(editor().getWatermark()).toBeNull();
  });

  test('Cancel writes nothing', async () => {
    let closed = false;
    const { view, editor } = mount(
      <DocxEditorWatermarkDialog open onClose={() => (closed = true)} />
    );
    await settle();
    const before = editor().getDocumentHandle().revision;
    await click(view.getByLabelText('Text watermark'));
    await change(view.getByLabelText('Text'), 'URGENT');
    await click(view.getByText('Cancel'));
    expect(closed).toBe(true);
    expect(editor().getDocumentHandle().revision).toBe(before);
    expect(editor().getWatermark()).toBeNull();
  });

  test('a chosen picture applies as a picture watermark with washout and scale', async () => {
    const { view, editor } = mount(<DocxEditorWatermarkDialog open onClose={() => {}} />);
    await settle();
    await click(view.getByLabelText('Picture watermark'));
    // Apply waits for a picture.
    expect((view.getByText('Apply') as HTMLButtonElement).disabled).toBe(true);
    const input = view.container.querySelector<HTMLInputElement>(
      '[data-docx-dialog="watermark"] input[type="file"]'
    )!;
    const file = new File([PNG_1X1], 'logo.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(view.container.textContent).toContain('logo.png');
    await change(view.getByLabelText('Scale'), '2');
    await click(view.getByLabelText('Washout'));
    await click(view.getByText('Apply'));
    expect(editor().getWatermark()).toMatchObject({ kind: 'image', washout: false });
    const full = editor().query({ type: 'watermark' });
    expect(full?.imageData?.length).toBeGreaterThan(0);
  });

  test('custom presets fill the text choices', async () => {
    const { view } = mount(
      <DocxEditorWatermarkDialog open onClose={() => {}} presets={['INTERNAL', 'PUBLIC']} />
    );
    await settle();
    const options = [
      ...view.container.querySelectorAll<HTMLOptionElement>('[data-docx-dialog] datalist option'),
    ].map((option) => option.value);
    expect(options).toEqual(['INTERNAL', 'PUBLIC']);
  });
});
