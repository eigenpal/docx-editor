// The Vue twin of `packages/react/test/watermark-dialog.test.tsx`: the Insert menu opens the
// dialog, the form seeds from the document's watermark, Apply writes ONE setWatermark
// command, No watermark removes it, and Cancel writes nothing.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import { DocxEditorMenu } from '../src/editor/menu';
import { DocxEditorWatermarkDialog } from '../src/editor/DocxEditorWatermark';
import { mountEditorTree } from './helpers/mount';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

afterEach(() => {
  document.body.innerHTML = '';
});

/** One control, found by the visible text of its label. The dialog teleports, so search the document. */
function control(label: string): HTMLInputElement | HTMLSelectElement {
  const owner = [...document.querySelectorAll('[data-docx-dialog="watermark"] label')].find(
    (node) => node.textContent?.trim() === label
  ) as HTMLLabelElement | undefined;
  if (!owner) throw new Error(`no label ${label}`);
  const found = owner.htmlFor
    ? document.getElementById(owner.htmlFor)
    : owner.querySelector('input, select');
  if (!found) throw new Error(`no control labelled ${label}`);
  return found as HTMLInputElement | HTMLSelectElement;
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('[data-docx-dialog="watermark"] button')].find(
    (node) => node.textContent?.trim() === text
  );
  if (!found) throw new Error(`no button ${text}`);
  return found as HTMLButtonElement;
}

async function choose(element: HTMLInputElement): Promise<void> {
  element.click();
  await flush();
}

async function type(element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  element.value = value;
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input'));
  await flush();
}

const dialog = () => document.querySelector('[data-docx-dialog="watermark"]');

describe('DocxEditor.WatermarkDialog (Vue)', () => {
  test('the Insert menu opens the dialog, and Apply sets a text watermark in one undo step', async () => {
    const view = mountEditorTree(() => h(DocxEditorMenu));
    await flush();
    const trigger = view.container.querySelector(
      '[data-menu="insert"] .docx-menubar__trigger'
    ) as HTMLButtonElement;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    const row = view.container.querySelector('[data-slot="insert.watermark"]') as HTMLElement;
    expect(row.getAttribute('aria-disabled')).not.toBe('true');
    row.click();
    await flush();
    expect(dialog()).not.toBeNull();
    expect((control('No watermark') as HTMLInputElement).checked).toBe(true);
    expect(control('Text').disabled).toBe(true);

    await choose(control('Text watermark') as HTMLInputElement);
    expect(control('Text').disabled).toBe(false);
    await type(control('Text'), 'CONFIDENTIAL');
    await type(control('Size'), '72');
    await choose(control('Bold') as HTMLInputElement);
    await type(control('Transparency'), '25');
    await type(control('Color'), '#ff0000');
    await choose(control('Horizontal') as HTMLInputElement);
    button('Apply').click();
    await flush();

    expect(dialog()).toBeNull();
    const editor = view.editor();
    expect(editor.getWatermark()).toMatchObject({
      kind: 'text',
      text: 'CONFIDENTIAL',
      fontSizePt: 72,
      bold: true,
      color: 'FF0000',
      layout: 'horizontal',
    });
    expect(editor.getWatermark()!.transparency).toBeCloseTo(0.25, 2);
    editor.exec({ type: 'undo' });
    expect(editor.getWatermark()).toBeNull();
    view.unmount();
  });

  test('seeds from the existing watermark, and No watermark removes it', async () => {
    let closed = 0;
    const open = { value: false };
    const view = mountEditorTree(() =>
      open.value ? h(DocxEditorWatermarkDialog, { open: true, onClose: () => (closed += 1) }) : []
    );
    await flush();
    view.editor().exec({
      type: 'setWatermark',
      watermark: { text: 'SAMPLE', italic: true, layout: 'horizontal', fontSizePt: 54 },
    });
    open.value = true;
    view.viewportVisible.value = false;
    await flush();
    view.viewportVisible.value = true;
    await flush();
    expect((control('Text watermark') as HTMLInputElement).checked).toBe(true);
    expect(control('Text').value).toBe('SAMPLE');
    expect((control('Italic') as HTMLInputElement).checked).toBe(true);
    expect(control('Size').value).toBe('54');
    expect((control('Horizontal') as HTMLInputElement).checked).toBe(true);

    await choose(control('No watermark') as HTMLInputElement);
    button('Apply').click();
    await flush();
    expect(closed).toBe(1);
    expect(view.editor().getWatermark()).toBeNull();
    view.unmount();
  });

  test('Cancel writes nothing', async () => {
    let closed = 0;
    const view = mountEditorTree(() =>
      h(DocxEditorWatermarkDialog, { open: true, onClose: () => (closed += 1) })
    );
    await flush();
    const before = view.editor().getDocumentHandle().revision;
    await choose(control('Text watermark') as HTMLInputElement);
    await type(control('Text'), 'URGENT');
    button('Cancel').click();
    await flush();
    expect(closed).toBe(1);
    expect(view.editor().getDocumentHandle().revision).toBe(before);
    expect(view.editor().getWatermark()).toBeNull();
    view.unmount();
  });

  test('a chosen picture applies as a picture watermark', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorWatermarkDialog, { open: true, onClose: () => {}, presets: ['INTERNAL'] })
    );
    await flush();
    const options = [
      ...document.querySelectorAll<HTMLOptionElement>('[data-docx-dialog] datalist option'),
    ].map((option) => option.value);
    expect(options).toEqual(['INTERNAL']);

    await choose(control('Picture watermark') as HTMLInputElement);
    expect(button('Apply').disabled).toBe(true);
    const input = document.querySelector<HTMLInputElement>(
      '[data-docx-dialog="watermark"] input[type="file"]'
    )!;
    const file = new File([PNG_1X1], 'logo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(dialog()!.textContent).toContain('logo.png');
    await choose(control('Washout') as HTMLInputElement);
    button('Apply').click();
    await flush();
    expect(view.editor().getWatermark()).toMatchObject({ kind: 'image', washout: false });
    view.unmount();
  });
});
