/**
 * The same document automation, for a page that already has an editor open.
 *
 * ```ts
 * import { DocxEditor } from '@docx-editor.dev/agents/browser';
 *
 * const runtime = DocxEditor.createBrowser(editor);
 * await runtime.run(async (context) => { … });
 * ```
 *
 * A separate subpath rather than a second export from the package root, because `createBrowser`
 * reaches the editor lane, and the editor lane brings the painted engine and its font shaper with
 * it. Both namespaces expose `createServer`: opening bytes is neutral, and a page that opens an
 * attachment beside the document it is showing should not need two imports.
 *
 * The editor comes from wherever the host got it — `@docx-editor.dev/react`,
 * `@docx-editor.dev/vue`, or a plain page that created one directly. This package does not create
 * editors and does not own their lifetime.
 *
 * @packageDocumentation
 * @public
 */

import { createBrowser, type DocxEditorInstance } from './runtime/browser.ts';
import { createServer } from './runtime/server.ts';
import type {
  CreateServerOptions,
  DocxEditorRuntime,
  DocxEditorServerRuntime,
} from './runtime/public.ts';

export * from './runtime/public.ts';

/**
 * The entry point, with the editor-bound factory. A superset of the one at the package root.
 *
 * @public
 */
export interface DocxEditorNamespace {
  createBrowser(editor: DocxEditorInstance): DocxEditorRuntime;
  createServer(bytes: Uint8Array, options?: CreateServerOptions): Promise<DocxEditorServerRuntime>;
}

export const DocxEditor: DocxEditorNamespace = Object.freeze({
  /** A runtime over an editor that is already open. The editor keeps its own lifetime. */
  createBrowser,
  /** A runtime over DOCX bytes. Additionally offers `save()`. */
  createServer,
});
