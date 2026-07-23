// @docx-editor.dev/engine-binding
//
// EditorBinding: the ONLY ProseMirror-aware integration. Maps PM transactions to DocOps and reconciles the view from committed ModelChange evidence. No PM type leaks past this boundary.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md. This is a
// greenfield skeleton; capability implementation lands in the sections that own it.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_BINDING_PACKAGE = '@docx-editor.dev/engine-binding' as const;

export { docSchema } from './schema.ts';
export { modelToDoc, paragraphNodeToRuns } from './projection.ts';
export { EditorBinding, type ForwardResult } from './binding.ts';
export { type SelectionAnchor, captureSelection, resolveSelection } from './selection.ts';
export { type ImeState, type InboundChange, ImeSession } from './ime.ts';
