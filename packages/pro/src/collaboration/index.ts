/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro/collaboration` — Yjs replica factories and the module factory.
 *
 * The default entry imports no network provider. Import
 * `@docx-editor.dev/pro/collaboration/webrtc` for the WebRTC wrapper and
 * `@docx-editor.dev/pro/collaboration/hocuspocus` for the Hocuspocus wrapper.
 *
 * @packageDocumentation
 * @public
 */

export { collaborationModule, type CollaborationModuleOptions } from './collaboration-module.ts';
export type {
  CollaborationBootstrap,
  CollaborationHandle,
  CollaborationIdentityUpdate,
  CollaborationSession,
} from './types.ts';
export {
  createDocumentCollaboration,
  readCollaborationDocument,
  type CreateDocumentCollaborationOptions,
  type DocumentCollaborationHandle,
  type DocumentCollaborationSession,
} from './document-session.ts';
export { prepareCollaborationServerDocument } from './server-document.ts';
export {
  checkCollaborationRoomGeneration,
  compactCollaborationState,
  readCollaborationRoomGeneration,
  type CollaborationRoomGatePayload,
  type CompactCollaborationStateOptions,
} from './room-generation.ts';
export {
  readCollaborationResourceUsage,
  type CollaborationResourceUsage,
} from './resource-usage.ts';
export { CollaborationSchemaError } from './errors.ts';
export {
  DOCUMENT_COLLABORATION_VERSIONS,
  assertDocumentCollaborationCompatibility,
  type DocumentCollaborationVersions,
} from './document-compatibility.ts';
export {
  COLLABORATION_FORMAT_VERSION,
  assertCollaborationFormatCompatibility,
  readCollaborationFormatVersion,
} from './document-format.ts';
