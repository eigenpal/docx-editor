// @docx-editor.dev/engine-binding

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_BINDING_PACKAGE = '@docx-editor.dev/core-contract/binding' as const;

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
  type DocumentStyleEntry,
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
