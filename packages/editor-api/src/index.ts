/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Document automation for DOCX: a batching object model over the DocxEditor engine.
 *
 * Work is described against proxy objects and nothing reaches the document until
 * `context.sync()`, which sends one ordered batch and either applies all of it or none of it.
 * Reading a property nobody asked for is an error rather than a silent `undefined`.
 *
 * This entry needs no browser. It opens DOCX bytes, drives them, and saves them back, so a
 * server, a worker or a build script can import the package name and get the whole API.
 *
 * @example Read and edit a document on a server
 * ```ts
 * import { DocxEditor } from '@docx-editor.dev/editor-api';
 *
 * const runtime = await DocxEditor.createServer(bytes, { author: 'Payroll bot' });
 * try {
 *   await runtime.run(async (context) => {
 *     const paragraphs = context.document.body.paragraphs;
 *     paragraphs.load('items');
 *     await context.sync();
 *
 *     for (const paragraph of paragraphs.items) paragraph.load('text');
 *     await context.sync();
 *
 *     for (const paragraph of paragraphs.items) {
 *       if (paragraph.text.includes('{{name}}')) paragraph.insertText('Ada', 'Replace');
 *     }
 *     await context.sync();
 *   });
 *   const edited = await runtime.save();
 * } finally {
 *   runtime.dispose();
 * }
 * ```
 *
 * @example Drive an editor a reader already has open
 * ```ts
 * // `createBrowser` lives one subpath along, because reaching a live editor means
 * // reaching the painted engine. A consumer holding bytes should not pay for that.
 * import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
 *
 * const runtime = DocxEditor.createBrowser(editor);
 * await runtime.run(async (context) => {
 *   const heading = context.document.body.paragraphs.getFirstOrNullObject();
 *   heading.load('text');
 *   await context.sync();
 *
 *   if (!heading.isNullObject) heading.font.bold = true;
 *   await context.sync();
 * });
 * ```
 *
 * This is a DocxEditor-owned API whose shape is compatible with a documented subset of Word's
 * JavaScript object model. It is not Office.js, it does not run in an Office add-in host, and it
 * depends on no Microsoft package: every type in this surface is independently authored here.
 *
 * @packageDocumentation
 * @public
 */

import { createServer } from './runtime/server.ts';
import type { CreateServerOptions, DocxEditorServerRuntime } from './runtime/public.ts';

export * from './runtime/public.ts';

/**
 * The entry point, as much of it as works without an editor.
 *
 * An object rather than a TypeScript `namespace`: a namespace with runtime members is a
 * declaration-merging construct that does not survive being re-exported through a bundler as
 * predictably, and `DocxEditor.createServer` reads the same either way.
 *
 * Import from `@docx-editor.dev/editor-api/browser` for the same namespace plus `createBrowser`.
 *
 * @public
 */
export interface DocxEditorNamespace {
  /** A runtime over DOCX bytes. Additionally offers `save()`. */
  createServer(bytes: Uint8Array, options?: CreateServerOptions): Promise<DocxEditorServerRuntime>;
}

/**
 * The entry point: open a document and get a runtime to work against.
 *
 * Import from `@docx-editor.dev/editor-api/browser` for the same namespace plus `createBrowser`,
 * which borrows a live editor instead of owning bytes.
 *
 * @example
 * ```ts
 * import { DocxEditor } from '@docx-editor.dev/editor-api';
 *
 * const runtime = await DocxEditor.createServer(bytes, { author: 'Payroll bot' });
 * await runtime.run(async (context) => {
 *   const body = context.document.body;
 *   body.load('text');
 *   await context.sync();
 * });
 * const saved = await runtime.save();
 * ```
 *
 * @public
 */
export const DocxEditor: DocxEditorNamespace = Object.freeze({
  /** A runtime over DOCX bytes. Additionally offers `save()`. */
  createServer,
});
