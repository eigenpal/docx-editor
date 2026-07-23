// @docx-editor.dev/engine-clients
//
// Generated language clients (TypeScript, Python, ...): schema bindings only over the RPC/command schemas. No model, normalization, layout, or serialization logic.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md. This is a
// greenfield skeleton; capability implementation lands in the sections that own it.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_CLIENTS_PACKAGE = '@docx-editor.dev/engine-clients' as const;
