/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro` — the review module and integrator-defined custom nodes.
 *
 * Registering a module is the whole enablement story: the review chrome slots light up through
 * the same `toolbarCommandState` that disabled them, and the editor renders revisions as markup
 * rather than the free tier's final-state projection.
 *
 * @example Enable comments, tracked changes, and a custom node type
 * ```ts
 * import { reviewModule, customNodesModule, defineCustomNode } from '@docx-editor.dev/pro';
 *
 * const citation = defineCustomNode({ name: 'citation', tagPrefix: 'acme' });
 * const editor = createDocxEditor({
 *   document: bytes,
 *   modules: [reviewModule(), customNodesModule({ nodes: [citation] })],
 * });
 * ```
 *
 *
 * Framework-neutral entry: the review module and custom nodes. React chrome
 * lives under `@docx-editor.dev/pro/react`.
 *
 * @packageDocumentation
 * @public
 */

export { reviewModule, type ReviewModuleOptions } from './review/review-module.ts';
export { type ProLicenseOptions } from './license.ts';
export {
  customNodesModule,
  defineCustomNode,
  isCustomNodeDefinition,
  recognizeCustomNodes,
  type ActivatedCustomNode,
  type CustomNodeDefinition,
  type CustomNodesModuleOptions,
  type RecognizedCustomNode,
} from './custom-nodes/define-custom-node.ts';
export {
  decodeCustomNodeTag,
  encodeCustomNodeTag,
  MAX_TAG_LENGTH,
  type DecodedCustomNodeTag,
  type EncodeTagResult,
} from './custom-nodes/tag-codec.ts';
export {
  insertCustomNode,
  type InsertCustomNodeOptions,
} from './custom-nodes/insert-custom-node.ts';
export {
  removeCustomNode,
  updateCustomNode,
  type UpdateCustomNodeOptions,
} from './custom-nodes/update-custom-node.ts';
export {
  customNodeXml,
  type CustomNodeXmlOptions,
  type CustomNodeXmlResult,
} from './custom-nodes/sdt-xml.ts';
