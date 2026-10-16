/**
 * `@docx-editor.dev/core/contracts/types` — the shared type vocabulary. Zero runtime.
 *
 * Addressing (`DocAnchor`, `DocTarget`), the document model, and the geometry primitives every
 * other contract is written in terms of.
 *
 * @packageDocumentation
 * @public
 */
export type * from './types';
// Store, layout and collaboration types that the shared vocabulary hands out. `types.ts` may
// not import those lanes, so they come through `editor.ts`, which re-exports them.
export type {
  CollaborationFailureCode,
  CollaborationStatus,
  DocumentProtectionEdit,
  DocumentProtectionState,
  ReviewPosition,
  ReviewRange,
  ReviewRevisionItem,
  ReviewRevisionKind,
  RevisionAddress,
  RevisionAuthorEntry,
  RevisionAuthorSkipReason,
  RevisionBatchEntry,
  RevisionBatchSkipDetail,
  RevisionBatchSkipReason,
  RevisionDisplayMode,
  RevisionSiteRefusal,
} from './editor.ts';
