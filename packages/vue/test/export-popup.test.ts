import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref, type PropType } from 'vue';
import type { ChromeExportHandlers, ChromeExportFormat } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorMenu } from '../src/editor/menu';
import {
  DocxEditorExportDialog,
  type DocxEditorExportDialogProps,
} from '../src/editor/DocxEditorExportDialog';
import type { DocxEditorPopups } from '../src/editor/popup-config';
import { definePopup } from '../src/editor/popup-renderer';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
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
async function exportPdf(container: HTMLElement) {
  (container.querySelector('[data-menu="file"] > button') as HTMLButtonElement).click();
  await flush();
  container.querySelector('.docx-menubar__submenu')!.dispatchEvent(new MouseEvent('mouseenter'));
  await flush();
  (container.querySelector('[data-slot="file.exportPdf"]') as HTMLButtonElement).click();
  await flush();
}

for (const packaged of [false, true]) {
  test(`export override keeps component state from progress to failure (packaged=${packaged})`, async () => {
    let fail!: (reason: Error) => void;
    const conversion = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    let latest!: DocxEditorExportDialogProps;
    const CustomExport = defineComponent({
      props: {
        open: { type: Boolean, required: true },
        pending: { type: Boolean, required: true },
        format: { type: String as PropType<ChromeExportFormat>, required: true },
        error: { type: String, required: true },
        onClose: { type: Function as PropType<() => void>, required: true },
      },
      setup(props) {
        const count = ref(0);
        return () => {
          latest = { ...props };
          return h(
            DocxEditorExportDialog,
            { ...props, className: 'custom-export', style: { maxWidth: '420px' } },
            {
              default: () => [
                h('p', props.error || props.format),
                h(
                  'button',
                  { 'data-count': '', onClick: () => count.value++ },
                  `Count ${count.value}`
                ),
                h('button', { 'data-dismiss': '', onClick: props.onClose }, 'Dismiss export'),
              ],
            }
          );
        };
      },
    });
    const container = mount(
      packaged,
      { export: definePopup(CustomExport) },
      { pdf: () => conversion }
    );
    await flush();
    await exportPdf(container);
    expect(latest.open).toBe(true);
    expect(latest.format).toBe('pdf');
    expect(latest.pending).toBe(true);
    expect(latest.error).toBe('');
    expect(container.querySelectorAll('dialog')).toHaveLength(1);
    expect(container.querySelector('.custom-export')?.getAttribute('style')).toContain('420px');
    (container.querySelector('[data-count]') as HTMLButtonElement).click();
    await flush();
    fail(new Error('PDF service unavailable'));
    await flush();
    expect(latest.pending).toBe(false);
    expect(latest.error).toContain('PDF service unavailable');
    expect(container.querySelector('[data-count]')?.textContent).toBe('Count 1');
    (container.querySelector('[data-dismiss]') as HTMLButtonElement).click();
    await flush();
    expect(container.querySelector('dialog')).toBeNull();
    await exportPdf(container);
    expect(container.querySelector('[data-count]')?.textContent).toBe('Count 0');
  });

  test(`export callbacks receive missing PDF setup errors (packaged=${packaged})`, async () => {
    const container = mount(packaged, {
      export: (props) => h(DocxEditorExportDialog, { ...props, className: 'callback-export' }),
    });
    await flush();
    await exportPdf(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Install @docx-editor.dev/docx-to-pdf on your Node.js server and configure menu.exporters.pdf.'
    );
    expect(
      container.querySelector('[role="alertdialog"]')?.classList.contains('callback-export')
    ).toBe(true);
    (container.querySelector('dialog button') as HTMLButtonElement).click();
    await flush();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test(`false hides feedback without disabling conversion (packaged=${packaged})`, async () => {
    let calls = 0;
    const container = mount(
      packaged,
      { export: false },
      {
        pdf: async () => {
          calls++;
          throw new Error('Handled by the host');
        },
      }
    );
    await flush();
    await exportPdf(container);
    expect(calls).toBe(1);
    expect(container.querySelector('dialog')).toBeNull();
    await exportPdf(container);
    expect(calls).toBe(2);
  });
}

test('the public export dialog respects controlled visibility', async () => {
  const container = document.createElement('div');
  const app = createApp({
    render: () =>
      h(DocxEditorExportDialog, {
        open: false,
        pending: true,
        format: 'markdown',
        error: '',
        onClose() {},
      }),
  });
  app.mount(container);
  try {
    await flush();
    expect(container.querySelector('dialog')).toBeNull();
    expect(DocxEditor.ExportDialog).toBe(DocxEditorExportDialog);
  } finally {
    app.unmount();
  }
});
