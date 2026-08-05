/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro` — commercial capabilities for docx-editor.dev.
 *
 * Framework-neutral entry: the review module and custom nodes. React chrome
 * lives under `@docx-editor.dev/pro/react`.
 */

export { reviewModule, type ReviewModuleOptions } from './review/review-module.ts';
export { type ProLicenseOptions } from './license.ts';
export {
  customNodesModule,
  defineCustomNode,
  recognizeCustomNodes,
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
