/**
 * Vue renderAsync — scaffold for community implementation.
 *
 * This is a placeholder that defines the expected API.
 * A Vue contributor can implement this using `createApp().mount()`.
 */

import type { EditorHandle } from '@eigenpal/docx-core';

/** Options for the Vue renderAsync (to be defined by implementor). */
export interface VueRenderAsyncOptions {
  readOnly?: boolean;
  toolbar?: 'compact' | 'ribbon';
  showToolbarWhenReadOnly?: boolean;
}

/**
 * Render a DOCX editor into a container element using Vue.
 *
 * @param input - DOCX data (ArrayBuffer, Uint8Array, Blob, or File)
 * @param container - DOM element to render into
 * @param options - Editor configuration
 * @returns A handle implementing the framework-agnostic EditorHandle interface
 */
export function renderAsync(
  _input: ArrayBuffer | Uint8Array | Blob | File,
  _container: HTMLElement,
  _options: VueRenderAsyncOptions = {}
): Promise<EditorHandle> {
  throw new Error(
    '@eigenpal/docx-editor-vue renderAsync is not yet implemented. ' +
      'Community contributions welcome!'
  );
}
