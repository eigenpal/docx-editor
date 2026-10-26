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
  reactive,
  ref,
  shallowRef,
} from 'vue';
import { markUnsupportedElement } from '../../core/src/output/unsupported-elements.ts';
import { DocxEditorUnsupportedElement } from '../src/editor/DocxEditorUnsupportedElement';
import { UnsupportedElements } from '../src/editor/UnsupportedElements';
import type { UnsupportedElement } from '@docx-editor.dev/core/output';
import type { EquationSpanRecord } from '@docx-editor.dev/core/layout';

function placeholder(container: HTMLElement, label: string) {
  const element = document.createElement('span');
  const fallback = document.createElement('span');
  fallback.textContent = label;
  element.append(fallback);
  markUnsupportedElement(element, fallback, {
    ownerPartName: 'word/document.xml',
    namespaceUri: 'urn:test',
    localName: 'equation',
    placement: 'inline',
    source: {
      id: label,
      kind: 'generic',
      namespaceUri: 'urn:test',
      localName: 'equation',
      namespaceBindings: [],
      attributes: [],
      children: [],
    },
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
  let mounted = true;
  try {
    await tick();
    expect(container.querySelector('button')!.textContent).toBe('from host');
    expect(first.fallback.hidden).toBe(true);
    container.querySelector('button')!.click();
    expect(clicks).toBe(1);
    // The observer stays live while collection must not remove its mutation callback.
    Bun.gc(true);
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
    mounted = false;
    expect(unmounts).toBe(3);
    expect(second.fallback.hidden).toBe(false);
    expect(container.querySelector('button')).toBeNull();
  } finally {
    if (mounted) app.unmount();
    container.replaceChildren();
    mount.remove();
  }
});

test('the public Vue editor customizes the sample chart', async () => {
  const { readFileSync } = await import('node:fs');
  const { DocxEditor } = await import('../src/components/DocxEditor');
  const { flush } = await import('./helpers/mount');
  const source = new Uint8Array(
    readFileSync(
      new URL('../../core/src/output/__tests__/fixtures/unsupported-chart.docx', import.meta.url)
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
          default: () =>
            h(DocxEditorUnsupportedElement, null, {
              default: ({ element }: { element: UnsupportedElement }) =>
                element.drawing
                  ? h(
                      'button',
                      { 'data-testid': 'chart-custom' },
                      element.drawing?.placeholderGraphicKind ?? 'graphic'
                    )
                  : null,
            }),
        }
      ),
  });
  app.mount(container);
  await flush();
  await waitForElement(container, '[data-testid="chart-custom"]');
  expect(container.querySelector('[data-testid="chart-custom"]')!.textContent).toBe('chart');
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
          default: () =>
            render.value
              ? h(DocxEditorUnsupportedElement, null, {
                  default: ({ element }: { element: UnsupportedElement }) =>
                    render.value?.(element),
                })
              : null,
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
      new URL('../../core/src/output/__tests__/fixtures/unsupported-chart.docx', import.meta.url)
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
            default: () =>
              h(DocxEditorUnsupportedElement, null, {
                default: ({ element }: { element: UnsupportedElement }) => [
                  h(
                    Fragment,
                    null,
                    visible.value
                      ? [h(Custom, { label: element.label })]
                      : [createCommentVNode('v-if')]
                  ),
                ],
              }),
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

test('Root declarations restore comment-only fallback content', async () => {
  const { DocxEditorRoot } = await import('../src/editor/DocxEditorRoot');
  const { DocxEditorContent } = await import('../src/editor/DocxEditorContent');
  const { flush } = await import('./helpers/mount');
  const visible = ref(true);
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(DocxEditorRoot, null, {
        default: () => [
          h(DocxEditorContent),
          h(DocxEditorUnsupportedElement, null, {
            default: ({ element }: { element: UnsupportedElement }) =>
              visible.value
                ? h('button', { 'data-testid': 'content-custom' }, element.label)
                : h(Comment),
          }),
        ],
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

test('Vue compound declarations select the first match and retain priority on updates', async () => {
  const { createUnsupportedElementRegistry, UnsupportedElementRegistryContext } =
    await import('../src/editor/unsupported-element-registry');
  const registry = createUnsupportedElementRegistry();
  const container = document.createElement('div');
  const { fallback } = placeholder(container, 'target');
  registry.setContainer(container);
  const matches = ref(false);
  const mounted = ref(true);
  const Local = defineComponent({
    setup() {
      provide('declaration-context', 'local');
      return () =>
        h(
          DocxEditorUnsupportedElement,
          { match: matches.value ? () => true : () => false },
          { default: () => h(Custom) }
        );
    },
  });
  const Custom = defineComponent({
    setup() {
      const value = inject('declaration-context');
      return () => h('button', String(value));
    },
  });
  const app = createApp({
    setup() {
      provide(UnsupportedElementRegistryContext, registry);
      return () => [
        mounted.value ? h(Local) : null,
        h(DocxEditorUnsupportedElement, null, { default: () => h('b', 'catch-all') }),
      ];
    },
  });
  const mount = document.createElement('div');
  app.mount(mount);
  await nextTick();
  expect(container.querySelector('b')?.textContent).toBe('catch-all');
  matches.value = true;
  await nextTick();
  expect(container.querySelector('button')?.textContent).toBe('local');
  expect(container.querySelector('b')).toBeNull();
  expect(fallback.hidden).toBe(true);
  mounted.value = false;
  await nextTick();
  expect(container.querySelector('b')?.textContent).toBe('catch-all');
  expect(fallback.hidden).toBe(true);
  app.unmount();
  expect(fallback.hidden).toBe(false);
  registry.setContainer(null);
});

test('Vue declarations track dimensions mutated inside a reactive layout object', async () => {
  const { createUnsupportedElementRegistry, UnsupportedElementRegistryContext } =
    await import('../src/editor/unsupported-element-registry');
  const registry = createUnsupportedElementRegistry();
  const layout = reactive({ width: 50, height: 20 });
  const app = createApp({
    setup() {
      provide(UnsupportedElementRegistryContext, registry);
      return () => h(DocxEditorUnsupportedElement, { layout }, { default: () => null });
    },
  });
  const mount = document.createElement('div');
  app.mount(mount);
  try {
    expect(registry.current()[0]?.layout).toEqual({ width: 50, height: 20 });
    layout.width = 80;
    layout.height = 40;
    await nextTick();
    expect(registry.current()[0]?.layout).toEqual({ width: 80, height: 40 });
  } finally {
    app.unmount();
  }
  expect(registry.current()).toEqual([]);
});

test('Vue exposes one unsupported drawing alternative and restores its fallback', async () => {
  const { readFileSync } = await import('node:fs');
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
  const { DocxEditor } = await import('../src/components/DocxEditor');
  const parts = unzipSync(
    new Uint8Array(
      readFileSync(
        new URL('../../core/src/output/__tests__/fixtures/unsupported-chart.docx', import.meta.url)
      )
    )
  );
  parts['word/document.xml'] = strToU8(
    strFromU8(parts['word/document.xml']!).replace(
      /<w:drawing>[\s\S]*?<\/w:drawing>/,
      (drawing) =>
        `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wpc">${drawing}</mc:Choice><mc:Fallback><w:pict><v:group xmlns:v="urn:schemas-microsoft-com:vml" alt="Group structure chart" style="width:120pt;height:60pt"/></w:pict></mc:Fallback></mc:AlternateContent>`
    )
  );
  const documentBytes = zipSync(parts);
  const custom = ref(true);
  let captured: UnsupportedElement | undefined;
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditor,
        { document: documentBytes, chrome: false },
        {
          default: () =>
            h(DocxEditorUnsupportedElement, null, {
              default: ({ element }: { element: UnsupportedElement }) => {
                captured = element;
                return custom.value
                  ? h('img', { alt: 'Server drawing preview', src: '/preview.png' })
                  : null;
              },
            }),
        }
      ),
  });
  app.mount(container);
  try {
    await waitForElement(container, 'img[alt="Server drawing preview"]');
    expect(container.querySelectorAll('[data-docx-unsupported]')).toHaveLength(1);
    expect(captured?.source?.localName).toBe('AlternateContent');
    expect(captured?.ownerPartName).toBe('/word/document.xml');
    expect(captured?.drawing?.placeholderGraphicKind).toBe('chart');
    expect(
      captured?.source?.children.map((child) => (child.kind === 'textValue' ? '' : child.localName))
    ).toEqual(['Choice', 'Fallback']);
    const label = container.querySelector<HTMLElement>('.docx-drawing-placeholder-label')!;
    expect(label.hidden).toBe(true);
    custom.value = false;
    await tick();
    expect(label.hidden).toBe(false);
    expect(container.querySelector('img[alt="Server drawing preview"]')).toBeNull();
  } finally {
    app.unmount();
    container.remove();
  }
});
