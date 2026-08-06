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
  type AnyCustomNodeDefinition,
  type CustomNode,
  type CustomNodeDefinition,
  type CustomNodeDiagnostic,
  type CustomNodePayloadSource,
  type CustomNodesModuleOptions,
  type RecognizedCustomNode,
} from './custom-nodes/define-custom-node.ts';
export {
  exportCustomNodes,
  type DocumentDestination,
  type ExportCustomNodesOptions,
  type ExportCustomNodesResult,
} from './custom-nodes/export-custom-nodes.ts';
export { CUSTOM_NODE_STORE_ROOT, customNodeNamespace } from './custom-nodes/node-payload.ts';
export {
  MAX_CUSTOM_NODE_DATA_LENGTH,
  parseCustomNodeData,
  serializeCustomNodeData,
  type CustomNodeDataRejection,
  type CustomNodeDataResult,
  type InferSchemaInput,
  type InferSchemaOutput,
  type StandardSchemaIssue,
  type StandardSchemaResult,
  type StandardSchemaV1,
} from './custom-nodes/data-schema.ts';
export {
  decodeCustomNodeTag,
  encodeCustomNodeTag,
  MAX_TAG_LENGTH,
  type DecodedCustomNodeTag,
  type EncodeTagResult,
} from './custom-nodes/tag-codec.ts';
export { insertCustomNode, type CustomNodeInput } from './custom-nodes/insert-custom-node.ts';
export {
  type CustomNodeIssue,
  type CustomNodeWriteOutcome,
} from './custom-nodes/node-write-result.ts';
export {
  removeCustomNode,
  updateCustomNode,
  type CustomNodeUpdate,
} from './custom-nodes/update-custom-node.ts';
export {
  customNodeXml,
  type CustomNodeXmlOptions,
  type CustomNodeXmlResult,
  type CustomNodeXmlStore,
} from './custom-nodes/sdt-xml.ts';
