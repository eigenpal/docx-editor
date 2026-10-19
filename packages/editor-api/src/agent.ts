/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Helpers for AI agents that edit documents through the editing API.
 *
 * `proposeRewrite` sends a paragraph to your model and proposes the answer as the fewest tracked
 * changes. Fields, pictures, equations, note references, and locked content controls reach the
 * model as numbered placeholders, so they change whole or not at all. Either every change lands
 * and the paragraph reads as the answer, or the paragraph stays as it was and the helper throws a
 * `RewriteError` with a stable `code`.
 *
 * The helpers sit next to the object model, not on it, and are outside its Office.js
 * compatibility scope. They use only the Office.js-shaped calls of
 * `@docx-editor.dev/editor-api`, on the `context` and `paragraph` that you pass in.
 *
 * @example Rewrite the first paragraph on a server
 * ```ts
 * import { DocxEditor } from '@docx-editor.dev/editor-api';
 * import { proposeRewrite } from '@docx-editor.dev/editor-api/agent';
 *
 * const runtime = await DocxEditor.createServer(bytes, { author: 'Rewrite agent' });
 * try {
 *   await runtime.run(async (context) => {
 *     const paragraph = context.document.body.paragraphs.getFirst();
 *     await proposeRewrite(context, paragraph, (draft) => callModel(draft.prompt), {
 *       instruction: 'Make it shorter.',
 *     });
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

export { prepareRewrite, proposeRewrite, proposeRewrites } from './agent/rewrite.ts';
export type {
  ProposeRewriteOptions,
  ProposeRewritesOptions,
  RewriteDraft,
  RewriteFeedback,
  RewriteFunction,
  RewriteItem,
  RewriteOptions,
  RewriteResult,
  RewriteSettledResult,
} from './agent/rewrite-types.ts';
export { RewriteError, type RewriteErrorCode } from './agent/rewrite-error.ts';
export type { RewritePlaceholder, RewritePlaceholderKind } from './agent/rewrite-plan.ts';
