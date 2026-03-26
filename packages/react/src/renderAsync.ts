/**
 * Simple imperative API for rendering a DOCX editor into a DOM element.
 *
 * Returns an `EditorHandle` (from @eigenpal/docx-core) that works with
 * any framework implementation.
 *
 * Usage:
 * ```ts
 * import { renderAsync } from '@eigenpal/docx-js-editor';
 *
 * const editor = await renderAsync(docxBlob, document.getElementById('container'), {
 *   readOnly: false,
 *   toolbar: 'compact',
 * });
 *
 * // Save the edited document
 * const blob = await editor.save();
 *
 * // Clean up
 * editor.destroy();
 * ```
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DocxEditor, type DocxEditorProps, type DocxEditorRef } from './components/DocxEditor';
import type { DocxInput } from '@eigenpal/docx-core/utils/docxInput';
import type { Document } from '@eigenpal/docx-core/types/document';
import type { EditorHandle } from '@eigenpal/docx-core';

/**
 * Options for {@link renderAsync}. A subset of DocxEditorProps minus
 * `documentBuffer` / `document` (passed as the first argument instead).
 */
export type RenderAsyncOptions = Omit<DocxEditorProps, 'documentBuffer' | 'document'>;

/**
 * React-specific handle that extends the framework-agnostic EditorHandle
 * with zoom control.
 */
export interface DocxEditorHandle extends EditorHandle {
  /** Set zoom level (1.0 = 100%). */
  setZoom: (zoom: number) => void;
}

/**
 * Render a DOCX editor into a container element.
 *
 * @param input - DOCX data as ArrayBuffer, Uint8Array, Blob, or File
 * @param container - DOM element to render into
 * @param options - Editor configuration (toolbar, readOnly, callbacks, etc.)
 * @returns A handle with save / destroy / getDocument methods
 */
export function renderAsync(
  input: DocxInput,
  container: HTMLElement,
  options: RenderAsyncOptions = {}
): Promise<DocxEditorHandle> {
  return new Promise<DocxEditorHandle>((resolve, reject) => {
    const ref = React.createRef<DocxEditorRef>();
    let root: Root | null = null;

    try {
      root = createRoot(container);
    } catch (err) {
      reject(err);
      return;
    }

    const handle: DocxEditorHandle = {
      save: async () => {
        const buffer = await (ref.current?.save() ?? Promise.resolve(null));
        if (!buffer) return null;
        return new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      },
      getDocument: () => ref.current?.getDocument() ?? null,
      focus: () => ref.current?.focus(),
      setZoom: (z) => ref.current?.setZoom(z),
      destroy: () => {
        root?.unmount();
        root = null;
      },
    };

    // Track whether we've already resolved/rejected to avoid double-calling
    let settled = false;

    const element = React.createElement(DocxEditor, {
      ...options,
      documentBuffer: input,
      onError: (error: Error) => {
        options.onError?.(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
      onChange: (doc: Document) => {
        options.onChange?.(doc);
        // First onChange means the document parsed and rendered successfully
        if (!settled) {
          settled = true;
          resolve(handle);
        }
      },
      ref,
    } as DocxEditorProps & { ref: React.Ref<DocxEditorRef> });

    root.render(element);
  });
}
