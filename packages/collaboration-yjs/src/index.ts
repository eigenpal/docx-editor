/**
 * Provider-neutral experimental Yjs collaboration for docx-editor.dev.
 *
 * @packageDocumentation
 * @public
 */

export {
  createYjsCollaboration,
  type CreateYjsCollaborationOptions,
  type YjsCollaborationBootstrap,
  type YjsCollaborationRoom,
  type YjsCollaborationSession,
} from './session.ts';
export {
  MAX_BASELINE_BYTES,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  CollaborationSchemaError,
} from './schema.ts';
