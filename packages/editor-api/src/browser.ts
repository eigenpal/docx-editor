/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The same document automation, for a page that already has an editor open.
 *
 * ```ts
 * import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
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
  /** A runtime over an editor that is already open. The editor keeps its own lifetime. */
  createBrowser(editor: DocxEditorInstance): DocxEditorRuntime;
  /** A runtime over DOCX bytes. Additionally offers `save()`. */
  createServer(bytes: Uint8Array, options?: CreateServerOptions): Promise<DocxEditorServerRuntime>;
}

/**
 * The entry point, with the editor-bound factory — a superset of the package root's.
 *
 * `createBrowser` borrows an editor that is already open, so the runtime reads and writes the
 * document the user is looking at. The editor keeps its own lifetime: disposing the runtime does
 * not close the editor.
 *
 * @example
 * ```ts
 * import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
 *
 * const runtime = DocxEditor.createBrowser(editor);
 * await runtime.run(async (context) => {
 *   const paragraphs = context.document.paragraphs;
 *   paragraphs.load('items');
 *   await context.sync();
 *
 *   for (const paragraph of paragraphs.items) paragraph.load('text');
 *   await context.sync();
 * });
 * ```
 *
 * @public
 */
export const DocxEditor: DocxEditorNamespace = Object.freeze({
  /** A runtime over an editor that is already open. The editor keeps its own lifetime. */
  createBrowser,
  /** A runtime over DOCX bytes. Additionally offers `save()`. */
  createServer,
});
