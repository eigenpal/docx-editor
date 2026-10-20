import './dom-setup.ts';
import { expect, test } from 'bun:test';
import {
  Comment,
  Fragment,
  createApp,
  createCommentVNode,
  defineComponent,
  h,
  inject,
  nextTick,
  onUnmounted,
  provide,
  ref,
  shallowRef,
} from 'vue';
import { markUnsupportedElement } from '../../core/src/output/unsupported-elements.ts';
import { UnsupportedElements } from '../src/editor/UnsupportedElements';
import type { UnsupportedElement } from '@docx-editor.dev/core/output';
import type { EquationSpanRecord } from '@docx-editor.dev/core/layout';

function placeholder(container: HTMLElement, label: string) {
  const element = document.createElement('span');
  const fallback = document.createElement('span');
  fallback.textContent = label;
  element.append(fallback);
  markUnsupportedElement(element, fallback, {
    kind: 'equation',
    nodeId: label,
    label,
    equation: {} as EquationSpanRecord,
  });
  container.append(element);
  return { element, fallback };
}
async function waitForElement(container: HTMLElement, selector: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (container.querySelector(selector)) return;
    await tick();
  }
  throw new Error(`Missing mounted element: ${selector}`);
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
}

test('custom components preserve context and clean up on repaint, null, and unmount', async () => {
  const container = document.createElement('div');
  const first = placeholder(container, 'first');
  const mount = document.createElement('div');
  const custom = ref(true);
  let clicks = 0;
  let unmounts = 0;
  const Custom = defineComponent({
    setup() {
      const value = inject('placeholder-context');
      onUnmounted(() => unmounts++);
      return () => h('button', { onClick: () => clicks++ }, String(value));
    },
  });
  const app = createApp({
    setup() {
      provide('placeholder-context', 'from host');
      return () =>
        h(UnsupportedElements, {
          container,
          render: () => (custom.value ? h(Custom) : null),
        });
    },
  });
  app.mount(mount);
  await tick();
  expect(container.querySelector('button')!.textContent).toBe('from host');
  expect(first.fallback.hidden).toBe(true);
  container.querySelector('button')!.click();
  expect(clicks).toBe(1);
  first.element.remove();
  const second = placeholder(container, 'second');
  await tick();
  expect(unmounts).toBe(1);
  expect(second.fallback.hidden).toBe(true);
  custom.value = false;
  await nextTick();
  expect(second.fallback.hidden).toBe(false);
  expect(container.querySelector('button')).toBeNull();
  custom.value = true;
  await nextTick();
  app.unmount();
  expect(unmounts).toBe(3);
  expect(second.fallback.hidden).toBe(false);
  expect(container.querySelector('button')).toBeNull();
});

test('the public Vue editor customizes the sample canvas', async () => {
  const { readFileSync } = await import('node:fs');
  const { DocxEditor } = await import('../src/components/DocxEditor');
  const { flush } = await import('./helpers/mount');
  const source = new Uint8Array(
    readFileSync(
      new URL('../../core/src/output/__tests__/fixtures/unsupported-canvas.docx', import.meta.url)
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditor,
        {
          document: source,
          chrome: false,
        },
        {
          unsupportedElement: ({ element }: { element: UnsupportedElement }) =>
            element.kind === 'drawing'
              ? h(
                  'button',
                  { 'data-testid': 'canvas-custom' },
                  element.drawing.placeholderGraphicKind ?? 'graphic'
                )
              : null,
        }
      ),
  });
  app.mount(container);
  await flush();
  await waitForElement(container, '[data-testid="canvas-custom"]');
  expect(container.querySelector('[data-testid="canvas-custom"]')!.textContent).toBe('graphic');
  expect(container.querySelector<HTMLElement>('.docx-drawing-placeholder-label')!.hidden).toBe(
    true
  );
  app.unmount();
  container.remove();
});

test('the Vue sugar host updates and removes the scoped slot without remounting', async () => {
  const { DocxEditor } = await import('../src/components/DocxEditor');
  const { flush } = await import('./helpers/mount');
  const render = shallowRef<
    ((element: UnsupportedElement) => ReturnType<typeof h> | null) | undefined
  >(() => h('button', { 'data-testid': 'custom-live' }, 'first'));
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditor,
        { chrome: false },
        {
          unsupportedElement: render.value
            ? ({ element }: { element: UnsupportedElement }) => render.value?.(element)
            : undefined,
        }
      ),
  });
  app.mount(container);
  const { fallback } = placeholder(container.querySelector('.docx-paginated-surface')!, 'live');
  await flush();
  await waitForElement(container, '[data-testid="custom-live"]');
  expect(container.querySelector('[data-testid="custom-live"]')!.textContent).toBe('first');
  expect(fallback.hidden).toBe(true);
  render.value = () => h('button', { 'data-testid': 'custom-live' }, 'second');
  await flush();
  expect(container.querySelector('[data-testid="custom-live"]')!.textContent).toBe('second');
  expect(container.contains(fallback)).toBe(true);
  render.value = undefined;
  await flush();
  expect(container.querySelector('[data-testid="custom-live"]')).toBeNull();
  expect(fallback.hidden).toBe(false);
  render.value = () => h('button', { 'data-testid': 'custom-live' }, 'third');
  await flush();
  expect(container.querySelector('[data-testid="custom-live"]')!.textContent).toBe('third');
  app.unmount();
  container.remove();
});

test('Vue sugar scoped slots retain context and restore fallback for empty content', async () => {
  const { readFileSync } = await import('node:fs');
  const { DocxEditor } = await import('../src/components/DocxEditor');
  const { flush } = await import('./helpers/mount');
  const source = new Uint8Array(
    readFileSync(
      new URL('../../core/src/output/__tests__/fixtures/unsupported-canvas.docx', import.meta.url)
    )
  );
  const visible = ref(true);
  const Custom = defineComponent({
    props: { label: String },
    setup(props) {
      const context = inject('slot-context');
      return () => h('button', { 'data-testid': 'scoped-custom' }, `${context}:${props.label}`);
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    setup() {
      provide('slot-context', 'host');
      return () =>
        h(
          DocxEditor,
          {
            document: source,
            chrome: false,
          },
          {
            unsupportedElement: ({ element }: { element: UnsupportedElement }) => [
              h(
                Fragment,
                null,
                visible.value ? [h(Custom, { label: element.label })] : [createCommentVNode('v-if')]
              ),
            ],
          }
        );
    },
  });
  app.mount(container);
  await flush();
  await waitForElement(container, '[data-testid="scoped-custom"]');
  const fallback = container.querySelector<HTMLElement>('.docx-drawing-placeholder-label')!;
  expect(container.querySelector('[data-testid="scoped-custom"]')!.textContent).toBe(
    `host:${fallback.textContent}`
  );
  expect(fallback.hidden).toBe(true);
  visible.value = false;
  await flush();
  expect(container.querySelector('[data-testid="scoped-custom"]')).toBeNull();
  expect(fallback.hidden).toBe(false);
  visible.value = true;
  await flush();
  expect(fallback.hidden).toBe(true);
  app.unmount();
  container.remove();
});

test('DocxEditor.Content accepts a scoped slot and restores comment-only fallback content', async () => {
  const { DocxEditorRoot } = await import('../src/editor/DocxEditorRoot');
  const { DocxEditorContent } = await import('../src/editor/DocxEditorContent');
  const { flush } = await import('./helpers/mount');
  const visible = ref(true);
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(DocxEditorRoot, null, {
        default: () =>
          h(DocxEditorContent, null, {
            unsupportedElement: ({ element }: { element: UnsupportedElement }) =>
              visible.value
                ? h('button', { 'data-testid': 'content-custom' }, element.label)
                : h(Comment),
          }),
      }),
  });
  app.mount(container);
  const { fallback } = placeholder(
    container.querySelector('.docx-paginated-surface')!,
    'content slot'
  );
  await flush();
  await waitForElement(container, '[data-testid="content-custom"]');
  expect(container.querySelector('[data-testid="content-custom"]')!.textContent).toBe(
    fallback.textContent
  );
  expect(fallback.hidden).toBe(true);
  visible.value = false;
  await nextTick();
  expect(fallback.hidden).toBe(false);
  expect(container.querySelector('[data-testid="content-custom"]')).toBeNull();
  app.unmount();
  container.remove();
});
