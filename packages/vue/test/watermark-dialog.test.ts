// The Vue twin of `packages/react/test/watermark-dialog.test.tsx`: the Insert menu opens the
// dialog, the form seeds from the document's watermark, Apply writes ONE setWatermark
// command, No watermark removes it, and Cancel writes nothing.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h, nextTick } from 'vue';
import type { Watermark } from '@docx-editor.dev/core/contracts/editor';
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

const preview = () =>
  document.querySelector<HTMLElement>('[data-docx-dialog="watermark"] [data-docx-part="preview"]')!;

async function choosePicture(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(
    '[data-docx-dialog="watermark"] input[type="file"]'
  )!;
  const file = new File([PNG_1X1], 'logo.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await flush();
}

/** The dialog opened over a document that already has `watermark`. */
async function seededDialog(watermark: Watermark | null) {
  let closed = 0;
  const open = { value: false };
  const view = mountEditorTree(() =>
    open.value ? h(DocxEditorWatermarkDialog, { open: true, onClose: () => (closed += 1) }) : []
  );
  await flush();
  if (watermark) view.editor().exec({ type: 'setWatermark', watermark });
  open.value = true;
  view.viewportVisible.value = false;
  await flush();
  view.viewportVisible.value = true;
  await flush();
  return Object.assign(view, { closed: () => closed });
}

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
    await choose(control('Picture watermark') as HTMLInputElement);
    expect(button('Apply').disabled).toBe(true);
    await choosePicture();
    expect(dialog()!.textContent).toContain('logo.png');
    // Auto fits the picture to the text area; a scale multiplies its natural size.
    expect(
      preview().querySelector('[data-docx-watermark-preview="picture"]')!.getAttribute('width')
    ).toBe('468');
    await type(control('Scale'), '2');
    expect(
      preview().querySelector('[data-docx-watermark-preview="picture"]')!.getAttribute('width')
    ).toBe('1.5');
    await choose(control('Washout') as HTMLInputElement);
    button('Apply').click();
    await flush();
    expect(view.editor().getWatermark()).toMatchObject({ kind: 'image', washout: false });
    view.unmount();
  });

  test('custom presets fill the preset select, and typed text shows Custom', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorWatermarkDialog, {
        open: true,
        onClose: () => {},
        presets: ['INTERNAL', 'PUBLIC'],
      })
    );
    await flush();
    const select = control('Preset') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Custom',
      'INTERNAL',
      'PUBLIC',
    ]);
    expect(select.disabled).toBe(true);
    await choose(control('Text watermark') as HTMLInputElement);
    expect(select.value).toBe('');
    await type(select, 'PUBLIC');
    expect(control('Text').value).toBe('PUBLIC');
    expect(select.value).toBe('PUBLIC');
    await type(control('Text'), 'PUBLIC v2');
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]!.textContent).toBe('Custom');
    view.unmount();
  });

  test('the preview draws the draft and follows every field', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorWatermarkDialog, { open: true, onClose: () => {} })
    );
    await flush();
    const part = preview();
    expect(part.getAttribute('aria-hidden')).toBe('true');
    expect(part.querySelector('[data-docx-watermark-preview]')).toBeNull();

    await choose(control('Text watermark') as HTMLInputElement);
    let text = preview().querySelector('[data-docx-watermark-preview="text"]')!;
    expect(text.textContent).toBe('DRAFT');
    expect(text.getAttribute('fill')).toBe('#C0C0C0');
    expect(text.getAttribute('fill-opacity')).toBe('0.5');
    expect(text.getAttribute('transform')).toContain('rotate(-45');
    expect(text.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');

    await type(control('Text'), 'SECRET');
    await type(control('Color'), '#ff0000');
    await type(control('Transparency'), '25');
    await choose(control('Bold') as HTMLInputElement);
    await choose(control('Horizontal') as HTMLInputElement);
    text = preview().querySelector('[data-docx-watermark-preview="text"]')!;
    expect(text.textContent).toBe('SECRET');
    expect(text.getAttribute('fill')).toBe('#FF0000');
    expect(text.getAttribute('fill-opacity')).toBe('0.75');
    expect(text.getAttribute('font-weight')).toBe('bold');
    expect(text.getAttribute('transform')).toBeNull();

    // The preview uses the page's box rule: Auto fills the 6.5 inch text area of a Letter
    // page, and a fixed size draws the glyphs at that size.
    await type(control('Text'), 'xd');
    text = preview().querySelector('[data-docx-watermark-preview="text"]')!;
    expect(text.textContent).toBe('xd');
    expect(text.getAttribute('textLength')).toBe('468');
    await type(control('Size'), '72');
    text = preview().querySelector('[data-docx-watermark-preview="text"]')!;
    expect(text.getAttribute('font-size')).toBe('72');

    await choose(control('No watermark') as HTMLInputElement);
    expect(preview().querySelector('[data-docx-watermark-preview]')).toBeNull();
    view.unmount();
  });

  test('Select picture is enabled for any kind, and a chosen file switches to Picture', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorWatermarkDialog, { open: true, onClose: () => {} })
    );
    await flush();
    await choose(control('Text watermark') as HTMLInputElement);
    expect(button('Select picture…').disabled).toBe(false);
    expect(control('Scale').disabled).toBe(true);
    expect(control('Washout').disabled).toBe(true);
    await choosePicture();
    expect((control('Picture watermark') as HTMLInputElement).checked).toBe(true);
    expect(control('Scale').disabled).toBe(false);
    const picture = preview().querySelector<SVGImageElement>(
      '[data-docx-watermark-preview="picture"]'
    )!;
    expect(picture.getAttribute('href')).toMatch(/^blob:/);
    expect(picture.style.filter).toContain('brightness');
    await choose(control('Washout') as HTMLInputElement);
    expect(
      preview().querySelector<SVGImageElement>('[data-docx-watermark-preview="picture"]')!.style
        .filter
    ).toBe('');

    // The button alone switches the kind too.
    await choose(control('Text watermark') as HTMLInputElement);
    button('Select picture…').click();
    await flush();
    expect((control('Picture watermark') as HTMLInputElement).checked).toBe(true);
    view.unmount();
  });

  test('initial focus lands on the checked kind', async () => {
    const view = await seededDialog({ text: 'SAMPLE' });
    expect(document.activeElement).toBe(control('Text watermark'));
    view.unmount();
  });

  test('an unchanged Apply closes without writing', async () => {
    const view = await seededDialog({ text: 'SAMPLE', italic: true });
    const before = view.editor().getDocumentHandle().revision;
    button('Apply').click();
    await flush();
    expect(view.closed()).toBe(1);
    expect(view.editor().getDocumentHandle().revision).toBe(before);
    // One undo removes the watermark: the Apply added no empty step on top of it.
    view.editor().exec({ type: 'undo' });
    expect(view.editor().getWatermark()).toBeNull();
    view.unmount();
  });

  test('No watermark on a document without one applies as no change', async () => {
    const view = await seededDialog(null);
    const before = view.editor().getDocumentHandle().revision;
    button('Apply').click();
    await flush();
    expect(view.closed()).toBe(1);
    expect(view.editor().getDocumentHandle().revision).toBe(before);
    expect(view.editor().snapshot().canUndo ?? false).toBe(false);
    view.unmount();
  });

  test('a full composition places the preview part, which follows the draft', async () => {
    const Mark = DocxEditorWatermarkDialog;
    const view = mountEditorTree(() =>
      h(
        Mark,
        { open: true, onClose: () => {}, preset: false },
        {
          default: () => [
            h(Mark.Body, null, {
              default: () => [
                h(Mark.Field, { name: 'textWatermark' }),
                h(Mark.Preview, { className: 'host-preview' }),
              ],
            }),
          ],
        }
      )
    );
    await flush();
    const part = preview();
    expect(part.classList.contains('host-preview')).toBe(true);
    expect(part.classList.contains('docx-dialog__preview')).toBe(true);
    expect(part.getAttribute('aria-hidden')).toBe('true');
    expect(part.querySelector('[data-docx-watermark-preview]')).toBeNull();
    await choose(control('Text watermark') as HTMLInputElement);
    expect(preview().querySelector('[data-docx-watermark-preview="text"]')?.textContent).toBe(
      'DRAFT'
    );
    view.unmount();
  });
});
