// @docx-editor.dev/engine-core
//
// Semantic core: bounded OPC/OOXML trust boundary, the canonical ordered OOXML tree,
// TreeDocumentStore, and TreeDocOp contracts. PM-free, DOM-free, Yjs-free,
// transport-neutral, PDF-free. Becomes the published @docx-editor.dev/core at the
// section 7/14 migration.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_CORE_PACKAGE = '@docx-editor.dev/core-contract/store' as const;

// Capability/runtime registry and frozen cross-cutting ids (task 0.1).
export * from './registry/index.ts';

// Runtime ports, budgets, cancellation, per-operation snapshots (task 0.3).
export * from './runtime/index.ts';

// Canonical artifact comparator formats (task 0.4).
export * from './comparators/index.ts';

// Shared conformance fixture format + replay harness (task 1.5).
export * from './conformance/index.ts';

// Bounded package trust boundary: OPC names, content types, relationships, the ordered
// OOXML tree, and the tree-lane package read/write (2.2, 2.6, tree lane).
export * from './package/index.ts';

// Semantic document store: TreeDocumentStore + TreeDocOps over the canonical tree.
export * from './store/index.ts';
