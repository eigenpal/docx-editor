/**
 * Vue renderAsync — mounts a DocxEditorVue into a container element.
 */

import { createApp, h, type App } from 'vue';
import DocxEditorVue from './components/DocxEditorVue.vue';
import type { EditorHandle } from '@eigenpal/docx-editor-core';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import { toArrayBuffer, type DocxInput } from '@eigenpal/docx-editor-core/utils';
import type { EditorMode } from './editor-mode';
import type { DocxEditorProps } from './docx-editor-props';
import type { DocxEditorRef } from './editor-ref';

/** Options for the Vue renderAsync. */
export type VueRenderAsyncOptions = Omit<DocxEditorProps, 'documentBuffer' | 'document'> & {
  onReady?: () => void;
  onError?: (error: Error) => void;
  onChange?: (document: Document) => void;
  onRename?: (name: string) => void;
  onMenuAction?: (action: string) => void;
  onModeChange?: (mode: EditorMode) => void;
};

/** Imperative handle returned by Vue `renderAsync()`. */
export interface DocxEditorHandle extends EditorHandle {
  /** Set zoom level (1.0 = 100%). */
  setZoom: (zoom: number) => void;
  /** Scroll to a body paragraph by Word `w14:paraId`. */
  scrollToParaId: (paraId: string) => boolean;
  /** Scroll to a raw ProseMirror document position. */
  scrollToPosition: (pmPos: number) => void;
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
  input: DocxInput,
  container: HTMLElement,
  options: VueRenderAsyncOptions = {}
): Promise<DocxEditorHandle> {
  // Convert once up front so the prop stays stable across re-renders.
  const buffer = input instanceof ArrayBuffer ? input : await toArrayBuffer(input);

  let editorRef: DocxEditorRef | null = null;
  let app: App | null = null;
  let settled = false;

  const handle: DocxEditorHandle = {
    save: async () => {
      const buffer = await (editorRef?.save() ?? Promise.resolve(null));
      return buffer
        ? new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          })
        : null;
    },
    getDocument: () => {
      return (editorRef?.getDocument() as Document | null | undefined) ?? null;
    },
    focus: () => {
      editorRef?.focus();
    },
    setZoom: (z) => {
      editorRef?.setZoom(z);
    },
    scrollToParaId: (paraId: string) => editorRef?.scrollToParaId(paraId) ?? false,
    scrollToPosition: (pmPos: number) => {
      editorRef?.scrollToPosition(pmPos);
    },
    destroy: () => {
      editorRef?.destroy();
      app?.unmount();
      app = null;
    },
  };

  return new Promise<DocxEditorHandle>((resolve, reject) => {
    app = createApp({
      setup() {
        return () =>
          h(DocxEditorVue, {
            ...options,
            documentBuffer: buffer,
            showToolbar: options.showToolbar ?? true,
            readOnly: options.readOnly ?? false,
            ref: (el: unknown) => {
              editorRef = (el as DocxEditorRef | null) ?? null;
            },
            onReady: () => {
              options.onReady?.();
              if (!settled) {
                settled = true;
                resolve(handle);
              }
            },
            onError: (error: Error) => {
              options.onError?.(error);
              if (!settled) {
                settled = true;
                reject(error);
              }
            },
            onChange: options.onChange,
            onRename: options.onRename,
            onMenuAction: options.onMenuAction,
            onModeChange: options.onModeChange,
          });
      },
    });

    app.mount(container);
  });
}
