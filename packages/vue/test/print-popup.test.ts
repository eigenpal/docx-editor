import './dom-setup.ts';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { createApp, createSSRApp, defineComponent, h, nextTick, ref, type PropType } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { ChromeExportHandlers } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorMenu } from '../src/editor/menu';
import {
  DocxEditorPrintDialog,
  type DocxEditorPrintDialogProps,
} from '../src/editor/DocxEditorPrintDialog';
import type { DocxEditorPopups } from '../src/editor/popup-config';
import { definePopup } from '../src/editor/popup-renderer';

// happy-dom cannot navigate a frame to a blob URL. Tests load the print frame themselves.
(
  window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
).happyDOM.settings.disableIframePageLoading = true;

const PDF = new TextEncoder().encode('%PDF-1.7\n');
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const frame of document.querySelectorAll('[data-docx-print-frame]')) frame.remove();
});
async function flush() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await nextTick();
}
function mount(packaged: boolean, popups: DocxEditorPopups, exporters?: ChromeExportHandlers) {
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      packaged
        ? h(DocxEditor, { document: 'blank', popups, menu: { exporters } })
        : h(
            DocxEditorRoot,
            { document: 'blank', popups },
            {
              default: () => [
                h(DocxEditorMenu, { exporters }),
                h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
              ],
            }
          ),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  return container;
}
/** Opens the File menu and returns its Print row. */
async function printRow(container: HTMLElement) {
  (container.querySelector('[data-menu="file"] > button') as HTMLButtonElement).click();
  await flush();
  return container.querySelector<HTMLButtonElement>('[data-slot="file.print"]')!;
}
async function selectPrint(container: HTMLElement) {
  (await printRow(container)).click();
  await flush();
}
/** Loads the hidden print frame with a window that records print calls. */
async function loadPrintFrame(calls: string[]) {
  const frame = document.querySelector<HTMLIFrameElement>('[data-docx-print-frame]')!;
  // A modal dialog would make the print frame inert, so it must be closed by now.
  const target = {
    focus: () => calls.push('focus'),
    print: () => calls.push(document.querySelector('dialog[open]') ? 'print-under-modal' : 'print'),
  };
  Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => target });
  frame.dispatchEvent(new Event('load'));
  await flush();
}
function button(container: HTMLElement, name: string) {
  return [...container.querySelectorAll('dialog button')].find(
    (element) => element.textContent === name
  ) as HTMLButtonElement | undefined;
}

/** Makes the browser report no PDF viewer until the returned function runs. */
function withoutPdfViewer() {
  Object.defineProperty(navigator, 'pdfViewerEnabled', { configurable: true, value: false });
  return () => delete (navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled;
}

for (const packaged of [false, true]) {
  test(`File > Print converts, opens the print dialog, and closes (packaged=${packaged})`, async () => {
    let finish!: (value: { bytes: Uint8Array }) => void;
    const container = mount(
      packaged,
      {},
      { pdf: () => new Promise((resolve) => (finish = resolve)) }
    );
    await selectPrint(container);
    const dialog = container.querySelector('dialog')!;
    expect(dialog.getAttribute('aria-label')).toBe('Preparing to print…');
    expect(dialog.getAttribute('data-docx-dialog')).toBe('print');
    expect(button(container, 'Cancel')).toBeDefined();

    finish({ bytes: PDF });
    await flush();
    const calls: string[] = [];
    await loadPrintFrame(calls);
    expect(calls).toEqual(['focus', 'print']);
    // The browser print dialog replaces the editor popup.
    expect(container.querySelector('dialog')).toBeNull();
    // The frame stays while the browser prints from it, inside the editor.
    expect(document.querySelectorAll('[data-docx-print-frame]')).toHaveLength(1);
    expect(
      document.querySelector('[data-docx-print-frame]')?.closest('.docx-editor')
    ).not.toBeNull();

    const again = await printRow(container);
    expect(again.disabled).toBe(false);
    again.click();
    await flush();
    // A new print replaces the previous frame.
    expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
  });

  test(`Cancel discards a conversion that finishes later (packaged=${packaged})`, async () => {
    let finish!: (value: { bytes: Uint8Array }) => void;
    const container = mount(
      packaged,
      {},
      { pdf: () => new Promise((resolve) => (finish = resolve)) }
    );
    await selectPrint(container);
    button(container, 'Cancel')!.click();
    await flush();
    expect(container.querySelector('dialog')).toBeNull();
    finish({ bytes: PDF });
    await flush();
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
    expect((await printRow(container)).disabled).toBe(false);
  });

  test(`a missing PDF handler shows setup instructions (packaged=${packaged})`, async () => {
    const container = mount(packaged, {});
    await selectPrint(container);
    const dialog = container.querySelector('dialog')!;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-label')).toBe('Print failed');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Install @docx-editor.dev/docx-to-pdf on your Node.js server and configure menu.exporters.pdf.'
    );
    expect(container.querySelector('dialog a')).toBeNull();
    button(container, 'Close')!.click();
    await flush();
    expect(container.querySelector('dialog')).toBeNull();
  });

  test(`without a PDF viewer the dialog offers the PDF (packaged=${packaged})`, async () => {
    const restore = withoutPdfViewer();
    try {
      const container = mount(packaged, {}, { pdf: async () => ({ bytes: PDF }) });
      await selectPrint(container);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'cannot print PDF files'
      );
      const open = container.querySelector('dialog a')!;
      expect(open.textContent).toBe('Open PDF');
      expect(open.getAttribute('href')).toStartWith('blob:');
      expect(open.getAttribute('rel')).toContain('noopener');
      expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
      button(container, 'Close')!.click();
      await flush();
      expect(container.querySelector('dialog')).toBeNull();
    } finally {
      restore();
    }
  });

  test(`a print override keeps component state from progress to failure (packaged=${packaged})`, async () => {
    let fail!: (reason: Error) => void;
    let latest!: DocxEditorPrintDialogProps;
    const CustomPrint = defineComponent({
      props: {
        open: { type: Boolean, required: true },
        pending: { type: Boolean, required: true },
        error: { type: String, required: true },
        url: { type: String, required: true },
        onClose: { type: Function as PropType<() => void>, required: true },
      },
      setup(props) {
        const count = ref(0);
        return () => {
          latest = { ...props };
          return h(
            DocxEditorPrintDialog,
            { ...props, className: 'custom-print', style: { maxWidth: '420px' } },
            {
              default: () => [
                h('p', props.pending ? 'Converting' : props.error),
                h('button', { onClick: () => count.value++ }, `Count ${count.value}`),
                h('button', { onClick: props.onClose }, 'Done'),
              ],
            }
          );
        };
      },
    });
    const container = mount(
      packaged,
      { print: definePopup(CustomPrint) },
      { pdf: () => new Promise((_resolve, reject) => (fail = reject)) }
    );
    await selectPrint(container);
    expect(latest).toMatchObject({ open: true, pending: true, error: '', url: '' });
    expect(container.querySelector('.custom-print')?.getAttribute('style')).toContain('420px');
    button(container, 'Count 0')!.click();
    await flush();
    fail(new Error('PDF service unavailable'));
    await flush();
    expect(latest.pending).toBe(false);
    expect(latest.error).toContain('PDF service unavailable');
    expect(button(container, 'Count 1')).toBeDefined();
    button(container, 'Done')!.click();
    await flush();
    expect(container.querySelector('dialog')).toBeNull();
    await selectPrint(container);
    expect(button(container, 'Count 0')).toBeDefined();
  });

  test(`false hides feedback and still prints (packaged=${packaged})`, async () => {
    let conversions = 0;
    const container = mount(
      packaged,
      { print: false },
      {
        pdf: async () => {
          conversions++;
          return { bytes: PDF };
        },
      }
    );
    await selectPrint(container);
    expect(container.querySelector('dialog')).toBeNull();
    const calls: string[] = [];
    await loadPrintFrame(calls);
    expect(calls).toEqual(['focus', 'print']);
    const again = await printRow(container);
    expect(again.disabled).toBe(false);
    again.click();
    await flush();
    expect(conversions).toBe(2);
  });
}

test('with no popup, a failed print does not lock File > Print', async () => {
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  let conversions = 0;
  const container = mount(
    false,
    { print: false },
    {
      pdf: async () => {
        conversions++;
        throw new Error('Handled by the host');
      },
    }
  );
  await selectPrint(container);
  expect(container.querySelector('dialog')).toBeNull();
  const again = await printRow(container);
  expect(again.disabled).toBe(false);
  again.click();
  await flush();
  expect(conversions).toBe(2);
  // No popup reports the failure, so the console does.
  expect(logged).toHaveBeenCalledWith('[docx-editor] print failed', expect.any(Error));
  logged.mockRestore();
});

test('the print shortcut inside the progress dialog does not print the page', async () => {
  const container = mount(false, {}, { pdf: () => new Promise(() => {}) });
  await selectPrint(container);
  const event = new KeyboardEvent('keydown', {
    key: 'p',
    code: 'KeyP',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  button(container, 'Cancel')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

test('the default dialog links only to blob URLs', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(DocxEditorPrintDialog, {
        open: true,
        pending: false,
        error: 'Print failed',
        url: 'javascript:alert(1)',
        onClose: () => {},
      }),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  expect(document.querySelector('dialog a')).toBeNull();
});

test('Cancel while the PDF loads stops before the print dialog opens', async () => {
  let finish!: (value: { bytes: Uint8Array }) => void;
  const container = mount(false, {}, { pdf: () => new Promise((resolve) => (finish = resolve)) });
  await selectPrint(container);
  finish({ bytes: PDF });
  await flush();
  // Conversion is done and the frame loads; the progress popup still shows.
  expect(document.querySelector('[data-docx-print-frame]')).not.toBeNull();
  button(container, 'Cancel')!.click();
  await flush();
  const calls: string[] = [];
  await loadPrintFrame(calls);
  expect(calls).toEqual([]);
  expect(container.querySelector('dialog')).toBeNull();
  expect((await printRow(container)).disabled).toBe(false);
});

test('the Print row shows its shortcut only with a PDF handler', async () => {
  const configured = mount(false, {}, { pdf: async () => ({ bytes: PDF }) });
  expect((await printRow(configured)).textContent).toContain('Ctrl+P');
  for (const cleanup of cleanups.splice(0)) cleanup();
  const unconfigured = mount(false, {});
  expect((await printRow(unconfigured)).textContent).not.toContain('Ctrl+P');
});

test('with no popup, a busy print leaves the shortcut to the browser', async () => {
  const container = mount(false, { print: false }, { pdf: () => new Promise(() => {}) });
  await selectPrint(container);
  const event = new KeyboardEvent('keydown', {
    key: 'p',
    code: 'KeyP',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  container.querySelector('[data-testid="docx-menubar"]')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

test('unmounting during conversion discards the PDF', async () => {
  let finish!: (value: { bytes: Uint8Array }) => void;
  mount(false, {}, { pdf: () => new Promise((resolve) => (finish = resolve)) });
  const container = document.body.lastElementChild as HTMLElement;
  await selectPrint(container);
  for (const cleanup of cleanups.splice(0)) cleanup();
  finish({ bytes: PDF });
  await flush();
  expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
});

test('the menu renders on a server without a document', async () => {
  const saved = globalThis.document;
  Reflect.deleteProperty(globalThis, 'document');
  try {
    const html = await renderToString(
      createSSRApp({
        render: () => h(DocxEditorMenu, { exporters: { pdf: async () => ({ bytes: PDF }) } }),
      })
    );
    expect(html).toContain('docx-menubar');
  } finally {
    globalThis.document = saved;
  }
});

/** Waits until the editor is ready, when the File menu enables its rows. */
async function ready(container: HTMLElement) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const row = await printRow(container);
    (container.querySelector('[data-menu="file"] > button') as HTMLButtonElement).click();
    await flush();
    if (!row.disabled) return;
  }
}

test('Ctrl+P prints from the editor only when a PDF handler is configured', async () => {
  const configured = mount(false, {}, { pdf: () => new Promise(() => {}) });
  await ready(configured);
  const init = { key: 'p', ctrlKey: true, bubbles: true, cancelable: true };
  let event = new KeyboardEvent('keydown', init);
  configured.querySelector('[data-testid="docx-menubar"]')!.dispatchEvent(event);
  await flush();
  expect(event.defaultPrevented).toBe(true);
  expect(configured.querySelector('dialog')?.getAttribute('aria-label')).toBe(
    'Preparing to print…'
  );
  for (const cleanup of cleanups.splice(0)) cleanup();

  const unconfigured = mount(false, {});
  await ready(unconfigured);
  event = new KeyboardEvent('keydown', init);
  unconfigured.querySelector('[data-testid="docx-menubar"]')!.dispatchEvent(event);
  await flush();
  expect(event.defaultPrevented).toBe(false);
  expect(unconfigured.querySelector('dialog')).toBeNull();
});

test('the public print dialog respects controlled visibility', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(DocxEditorPrintDialog, {
        open: false,
        pending: true,
        error: '',
        url: '',
        onClose: () => {},
      }),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  expect(container.querySelector('dialog')).toBeNull();
  expect(DocxEditor.PrintDialog).toBe(DocxEditorPrintDialog);
  expect(DocxEditorMenu.Print.docxSlot).toBe('file.print');
});
