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
export { runIsProjectable, EditorBinding, type ForwardResult } from './binding.ts';
export { type SelectionAnchor, captureSelection, resolveSelection } from './selection.ts';
export {
  observeComposition,
  deriveCompositionOverlay,
  mapCompositionRangeAfterRemote,
  applyCompositionOverlay,
  remoteChangePreservesCompositionAnchor,
  type CompositionCancelCode,
  type CompositionCancelOutcome,
} from './composition.ts';
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
  type EditSurfaceCommand,
  type EditSurfaceCommandResult,
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
  type InputHostViewport,
} from './input-host.ts';
export type { InputHostPlacementReason } from '@docx-editor.dev/core-contract/contracts/interaction';
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
export { treeSchema, runPropsOf, type ParagraphAttrs } from './tree-schema.ts';
export {
  bodyParagraphs,
  docToTreeOps,
  partHasNode,
  reconcileDoc,
  treeToDoc,
  type MapResult,
  type TreeBindingRejection,
} from './tree-binding.ts';
export {
  openTreeSession,
  PROJECTION_ORIGIN,
  type OpenTreeSessionResult,
  type TreeApplyResult,
  type TreeDocxSession,
  type TreeSessionRejection,
} from './tree-session.ts';
export {
  mountTreeSurface,
  type TreeSurface,
  type TreeSurfaceOptions,
  type TreeSurfaceState,
} from './tree-surface.ts';
