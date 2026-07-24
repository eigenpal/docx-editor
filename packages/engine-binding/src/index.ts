// @docx-editor.dev/engine-binding

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_BINDING_PACKAGE = '@docx-editor.dev/engine-binding' as const;

export { docSchema } from './schema.ts';
export {
  type NodeRole,
  type BlockProjector,
  registerBindingNode,
  registerBindingMark,
  registerBlockProjector,
  registerDefaultBlockProjector,
  nodeRole,
  projectBlock,
  hasBlockProjector,
  isBindingEditableKind,
  assertBindingLaneComplete,
  buildDocSchema,
} from './binding-capabilities.ts';
export { modelToDoc, paragraphNodeToRuns } from './projection.ts';
export { EditorBinding, type ForwardResult } from './binding.ts';
export { type SelectionAnchor, captureSelection, resolveSelection } from './selection.ts';
export { observeComposition, deriveCompositionOverlay, mapCompositionRangeAfterRemote, applyCompositionOverlay, remoteChangePreservesCompositionAnchor, type CompositionCancelCode, type CompositionCancelOutcome } from './composition.ts';
export {
  INPUT_POLICY_LIMITS,
  REJECTED_PASTE_SLICE,
  observeInput,
  boundClipboardText,
  boundClipboardHtml,
  rejectClipboardDataTransfer,
  rejectDropDataTransfer,
  validatePastedSlice,
  type InputRejection,
  type InputRejectionCode,
} from './input-policy.ts';
export { type ApplyResult, type DocxEditorSession, openDocxSession } from './session.ts';
export {
  type EditSurface,
  type MountEditSurfaceOptions,
  type PmSelectionSnapshot,
  mountEditSurface,
} from './edit-surface.ts';
export { type SemanticSelectionSyncRequest } from './semantic-sync.ts';
export {
  INPUT_HOST_MIN_WIDTH_PX,
  INPUT_HOST_MIN_HEIGHT_PX,
  clampRectToViewport,
  type InputHostAssistiveState,
  type InputHostPlacement,
  type InputHostPlacementRequest,
  type InputHostPlacementReason,
  type InputHostViewport,
} from './input-host.ts';
export {
  PAINTED_PAGES_ASSISTIVE_MARKER,
  applyAccessibleNamePolicy,
  applyAtomAccessibilityLabels,
  buildAccessibilityEntries,
  captureAccessibilityState,
  clearPaintedPagesPresentationOnly,
  freezeAccessibilityObservation,
  markPaintedPagesPresentationOnly,
  observeAccessibility,
  observeAccessibilityFromSession,
  reapplyAccessibilityProjectionDom,
  resolveAccessibilityNamePolicy,
  ATOM_EMBED_SELECTOR,
  type AccessibilityObservationRequest,
  type ObserveAccessibilityInput,
} from './accessibility-projection.ts';
