import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import type { TextFormFieldDialogSession } from '@docx-editor.dev/core/editor';
import { DocxEditorTextFormFieldDialog } from '../src/editor/DocxEditorTextFormFieldDialog';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function mount(
  accept: boolean,
  presentation: { asChild?: boolean; class?: unknown; className?: string } = {}
) {
  const controller = new AbortController();
  const saved: { text: string; maxLength: number }[] = [];
  const session: TextFormFieldDialogSession = {
    field: {
      fieldNodeId: 'f',
      start: 0,
      end: 1,
      enabled: true,
      defaultText: 'Initial',
      type: 'regular',
      maxLength: 0,
      format: '',
      chromeIds: [],
    },
    signal: controller.signal,
    canApply: () => !controller.signal.aborted,
    cancel: () => controller.abort(),
    apply: (text, options) => {
      saved.push({ text, maxLength: options.maxLength });
      if (accept) controller.abort();
      return accept;
    },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorTextFormFieldDialog,
        { session },
        {
          default: () => [
            h(
              DocxEditorTextFormFieldDialog.Apply,
              { asChild: true, ...presentation },
              {
                default: () =>
                  presentation.asChild === false
                    ? 'Save field'
                    : h('button', { 'data-save': '' }, 'Save field'),
              }
            ),
          ],
        }
      ),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  return { controller, saved, container };
}

test('custom Field Options Apply retains input wiring and closes only after an accepted write', async () => {
  const { container, saved } = mount(true);
  await nextTick();
  const input = container.querySelector(
    '[data-docx-field="defaultText"] input'
  ) as HTMLInputElement;
  input.value = 'Updated';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  (container.querySelector('[data-save]') as HTMLButtonElement).click();
  await nextTick();
  expect(saved).toEqual([{ text: 'Updated', maxLength: 0 }]);
  expect(container.querySelector('dialog')).toBeNull();
});

test('refused Field Options writes remain open and abort signals close the modal', async () => {
  const { container, controller } = mount(false);
  await nextTick();
  (container.querySelector('[data-save]') as HTMLButtonElement).click();
  await nextTick();
  expect(container.querySelector('[role="alert"]')?.textContent).not.toBe('');
  expect(container.querySelector('dialog')).not.toBeNull();
  controller.abort();
  await nextTick();
  expect(container.querySelector('dialog')).toBeNull();
});

for (const asChild of [false, true]) {
  test(`Vue native classes merge with packaged and className styles (asChild=${asChild})`, async () => {
    const { container, saved } = mount(true, {
      asChild,
      class: ['app-action', { 'app-active': true, 'app-hidden': false }],
      className: 'paired-class',
    });
    await nextTick();
    const button = container.querySelector<HTMLButtonElement>('[data-docx-part="apply"]')!;
    for (const name of ['docx-dialog__button', 'app-action', 'app-active', 'paired-class']) {
      expect(button.classList.contains(name)).toBe(true);
    }
    expect(button.classList.contains('app-hidden')).toBe(false);
    button.click();
    await nextTick();
    expect(saved).toHaveLength(1);
  });
}

test('forwarding optional SFC children does not expose a readonly DOM property', async () => {
  const { DocxEditorPageSetupDialog } = await import('../src/editor/DocxEditorPageSetup');
  const { defineComponent } = await import('vue');
  const warnings: string[] = [];
  const Wrapper = defineComponent({
    setup: () => () =>
      h(DocxEditorPageSetupDialog, {
        open: true,
        onClose: () => {},
        children: undefined,
      }),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(Wrapper);
  app.config.warnHandler = (message) => warnings.push(message);
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await nextTick();
  expect(warnings.filter((message) => message.includes('children'))).toEqual([]);
  expect(container.querySelector('dialog')?.hasAttribute('children')).toBe(false);
});
