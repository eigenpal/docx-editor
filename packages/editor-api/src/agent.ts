/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Helpers for AI agents that edit documents through the editing API.
 *
 * `prepareRewrite` reads a paragraph into text for a model, and `draft.apply()` proposes the
 * model's new text as the fewest tracked changes. Fields, pictures, equations, note references,
 * and locked content controls reach the model as numbered placeholders, so they change whole or
 * not at all. Either every change lands and the paragraph reads as the model text, or the
 * paragraph stays as it was and `apply()` throws a `RewriteError` with a stable `code`.
 *
 * You own the model call: the prompt, the instruction, retries, timeouts, and concurrency. The
 * helpers own only the document side, which is deterministic.
 *
 * The helpers sit next to the object model, not on it, and are outside its Office.js
 * compatibility scope. They use only the Office.js-shaped calls of
 * `@docx-editor.dev/editor-api`, on the `context` and `paragraph` that you pass in.
 *
 * @example Rewrite the first paragraph on a server
 * ```ts
 * import { DocxEditor } from '@docx-editor.dev/editor-api';
 * import { prepareRewrite } from '@docx-editor.dev/editor-api/agent';
 *
 * const runtime = await DocxEditor.createServer(bytes, { author: 'Rewrite agent' });
 * try {
 *   await runtime.run(async (context) => {
 *     const paragraph = context.document.body.paragraphs.getFirst();
 *     const draft = await prepareRewrite(context, paragraph);
 *     const prompt = `Make the paragraph shorter.\n\n${draft.legend}\n\n${draft.text}`;
 *     await draft.apply(await callModel(prompt));
 *   });
 *   const saved = await runtime.save();
 * } finally {
 *   runtime.dispose();
 * }
 * ```
 *
 * @packageDocumentation
 * @public
 */

export { prepareRewrite } from './agent/rewrite.ts';
export type { PrepareRewriteOptions, RewriteDraft, RewriteResult } from './agent/rewrite-types.ts';
export { RewriteError, type RewriteErrorCode } from './agent/rewrite-error.ts';
export type { RewritePlaceholder, RewritePlaceholderKind } from './agent/rewrite-plan.ts';
