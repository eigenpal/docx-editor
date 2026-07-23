// @docx-editor.dev/engine-core
//
// Semantic core: bounded OPC/OOXML trust boundary, canonical authored package model, DocumentStore, DocOp/ModelChange contracts, opaque anchors, history, and the DocxEditor.* dispatch/registry. PM-free, DOM-free, Yjs-free, transport-neutral, PDF-free. Becomes the published @docx-editor.dev/core at the section 7/14 migration.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md. This is a
// greenfield skeleton; capability implementation lands in the sections that own it.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_CORE_PACKAGE = '@docx-editor.dev/engine-core' as const;

// Capability/runtime registry and frozen cross-cutting ids (task 0.1).
export * from './registry/index.ts';

// Runtime ports, budgets, cancellation, per-operation snapshots (task 0.3).
export * from './runtime/index.ts';

// Canonical artifact comparator formats (task 0.4).
export * from './comparators/index.ts';

// Shared conformance fixture format + replay harness (task 1.5).
export * from './conformance/index.ts';

// Bounded package trust boundary: OPC names, content types, relationships (2.2, 2.6).
export * from './package/index.ts';

// Canonical authored package model + create-from-scratch (task 2.9).
export * from './model/index.ts';

// Semantic document store: contracts, DocOps, transactions, ModelChange (section 4).
export * from './store/index.ts';

// Shared utilities used by peripheral packages (opaque byte encoding).
export { utf8ToHex, hexToUtf8 } from './util/hex.ts';

// The DocxEditor.* public object model — the only public object-model namespace (section 7).
export { DocxEditor } from './docx-editor/index.ts';

// Base capability registration + completeness (section 9).
export {
  type PipelineRole,
  type EditableCapability,
  type CompletenessResult,
  REQUIRED_EDITABLE_ROLES,
  checkEditableComplete,
  PARAGRAPH_CAPABILITY,
  BASE_BUNDLE,
  buildBaseRegistry,
} from './capabilities/index.ts';
