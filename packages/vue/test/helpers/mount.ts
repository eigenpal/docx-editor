import './../dom-setup.ts';

import { createApp, h, nextTick, type App, type Component, type VNode } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../../src/editor/DocxEditorContent';
import { SOURCE, flush } from './fixtures';

function slotChildren(result: VNode | VNode[]): VNode[] {
  return Array.isArray(result) ? result : [result];
}

export type MountedEditor = {
  container: HTMLElement;
  app: App;
  editor: () => DocxEditorInstance;
  unmount: () => void;
};

export function mountEditorTree(
  rootChildren: () => VNode | VNode[],
  source: Uint8Array = SOURCE,
  viewportChildren: () => VNode | VNode[] = () => []
): MountedEditor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: source,
          onReady: (editor: import('@docx-editor.dev/core/contracts/editor').Editor) =>
            ready.push(editor as DocxEditorInstance),
        },
        {
          default: () => [
            ...slotChildren(rootChildren()),
            h(DocxEditorViewport, null, {
              default: () => [...slotChildren(viewportChildren()), h(DocxEditorContent)],
            }),
          ],
        }
      ),
  });
  app.mount(container);
  return {
    container,
    app,
    editor: () => ready.at(-1)!,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

export async function mountSugarAsync(
  props: Record<string, unknown> = {},
  slots: Record<string, () => VNode | VNode[] | string> = {}
): Promise<MountedEditor & { flush: typeof flush }> {
  const { DocxEditor } = await import('../../src/components/DocxEditor.tsx');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditor,
        {
          document: SOURCE,
          onReady: (editor: import('@docx-editor.dev/core/contracts/editor').Editor) =>
            ready.push(editor as DocxEditorInstance),
          ...props,
        },
        slots
      ),
  });
  app.mount(container);
  return {
    container,
    app,
    editor: () => ready.at(-1)!,
    flush,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

export function mountComponent(
  component: Component,
  props: Record<string, unknown> = {}
): MountedEditor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: SOURCE,
          onReady: (editor: import('@docx-editor.dev/core/contracts/editor').Editor) =>
            ready.push(editor as DocxEditorInstance),
        },
        {
          default: () => [
            h(component, props),
            h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
          ],
        }
      ),
  });
  app.mount(container);
  return {
    container,
    app,
    editor: () => ready.at(-1)!,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

export { flush, nextTick, SOURCE };
