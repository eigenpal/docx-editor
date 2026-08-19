import './../dom-setup.ts';

import {
  createApp,
  h,
  nextTick,
  ref,
  watchEffect,
  type App,
  type Component,
  type Ref,
  type VNode,
} from 'vue';
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
  /** Gate viewport-slot children without crossing Vue package instances in tests. */
  viewportVisible: Ref<boolean>;
};

export function mountEditorTree(
  rootChildren: () => VNode | VNode[],
  source: Uint8Array = SOURCE,
  viewportChildren: () => VNode | VNode[] = () => [],
  modules?: readonly import('@docx-editor.dev/core/editor').EditorModule[],
  rootProps: Record<string, unknown> = {}
): MountedEditor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const viewportVisible = ref(true);
  const app = createApp({
    setup() {
      const renderEpoch = ref(0);
      watchEffect(() => {
        void viewportVisible.value;
        renderEpoch.value++;
      });
      return () => {
        void renderEpoch.value;
        const viewportNodes = viewportVisible.value ? slotChildren(viewportChildren()) : [];
        return h(
          DocxEditorRoot,
          {
            document: source,
            ...(modules !== undefined ? { modules } : {}),
            ...rootProps,
            onReady: (editor: import('@docx-editor.dev/core/contracts/editor').Editor) =>
              ready.push(editor as DocxEditorInstance),
          },
          {
            default: () => [
              ...slotChildren(rootChildren()),
              h(DocxEditorViewport, null, {
                default: () => [h(DocxEditorContent), ...viewportNodes],
              }),
            ],
          }
        );
      };
    },
  });
  app.mount(container);
  return {
    container,
    app,
    editor: () => ready.at(-1)!,
    viewportVisible,
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
  const { onSave, onOpen, ...rest } = props;
  const viewportVisible = ref(true);
  const app = createApp({
    render: () =>
      h(
        DocxEditor,
        {
          document: SOURCE,
          onReady: (editor: import('@docx-editor.dev/core/contracts/editor').Editor) =>
            ready.push(editor as DocxEditorInstance),
          ...rest,
          ...(onSave !== undefined ? { saveHandler: onSave } : {}),
          ...(onOpen !== undefined ? { openHandler: onOpen } : {}),
        },
        slots
      ),
  });
  app.mount(container);
  return {
    container,
    app,
    editor: () => ready.at(-1)!,
    viewportVisible,
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
  const viewportVisible = ref(true);
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
    viewportVisible,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

export { flush, nextTick, SOURCE };
