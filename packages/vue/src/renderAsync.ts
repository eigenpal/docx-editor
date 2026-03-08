/**
 * Vue renderAsync — mounts a DocxEditorVue into a container element.
 */

import { createApp, h, type App } from 'vue';
import DocxEditorVue from './components/DocxEditorVue.vue';
import type { EditorHandle } from '@eigenpal/docx-core';

/** Options for the Vue renderAsync. */
export interface VueRenderAsyncOptions {
  readOnly?: boolean;
  showToolbar?: boolean;
}

/**
 * Render a DOCX editor into a container element using Vue.
 *
 * @param input - DOCX data (ArrayBuffer, Uint8Array, Blob, or File)
 * @param container - DOM element to render into
 * @param options - Editor configuration
 * @returns A handle implementing the framework-agnostic EditorHandle interface
 */
export async function renderAsync(
  input: ArrayBuffer | Uint8Array | Blob | File,
  container: HTMLElement,
  options: VueRenderAsyncOptions = {}
): Promise<EditorHandle> {
  // Convert to ArrayBuffer upfront — loadBuffer also handles this,
  // but we need a stable value for the prop.
  let buffer: ArrayBuffer;
  if (input instanceof Blob || input instanceof File) {
    buffer = await input.arrayBuffer();
  } else if (input instanceof Uint8Array) {
    buffer = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength
    ) as ArrayBuffer;
  } else {
    buffer = input;
  }

  let editorRef: any = null;

  const app: App = createApp({
    setup() {
      return () =>
        h(DocxEditorVue, {
          documentBuffer: buffer,
          showToolbar: options.showToolbar ?? true,
          readOnly: options.readOnly ?? false,
          ref: (el: any) => {
            editorRef = el;
          },
        });
    },
  });

  app.mount(container);

  // Wait a tick for mount to complete
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    save: async () => {
      return editorRef?.save() ?? null;
    },
    getDocument: () => {
      return editorRef?.getDocument() ?? null;
    },
    focus: () => {
      editorRef?.focus();
    },
    destroy: () => {
      editorRef?.destroy();
      app.unmount();
    },
  };
}
