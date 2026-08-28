/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro/collaboration` — Yjs replica factories and the module factory.
 *
 * The default entry imports no network provider. Import
 * `@docx-editor.dev/pro/collaboration/webrtc` for the WebRTC wrapper.
 *
 * @packageDocumentation
 * @public
 */

export { collaborationModule, type CollaborationModuleOptions } from './collaboration-module.ts';
export {
  createTextCollaboration,
  type CollaborationBootstrap,
  type CollaborationHandle,
  type CollaborationIdentityUpdate,
  type CollaborationSession,
  type CreateTextCollaborationOptions,
  type TextCollaborationHandle,
  type TextCollaborationSession,
} from './session.ts';
export {
  createDocumentCollaboration,
  readCollaborationDocument,
  type CreateDocumentCollaborationOptions,
  type DocumentCollaborationHandle,
  type DocumentCollaborationSession,
} from './document-session.ts';
export {
  readCollaborationResourceUsage,
  type CollaborationResourceUsage,
} from './resource-usage.ts';
export {
  MAX_BASELINE_BYTES,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  CollaborationSchemaError,
} from './schema.ts';
