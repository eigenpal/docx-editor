## 1. Preservation-backed body access policy

- [ ] 1.1 Add focused engine-core tests for `full`, `partial`, and `none` body modes, including tables, block content controls, paragraphs with unsupported inline children, missing ranges, and non-contiguous ranges.
- [ ] 1.2 Replace the single-result body patchability diagnostic with an immutable per-block access policy containing patchable IDs, all region/body diagnostics, document mode, and structural-mutation allowance; retain `isModelBodyPatchable` as the compatibility check for `mode === 'full'`.
- [ ] 1.3 Add regression evidence for an untouched preserved block whose store representation normalizes, then align preservation baseline/edit comparison with deterministic store normalization so editing a different paragraph cannot create a false changed-block result.
- [ ] 1.4 Verify engine-core preservation, table, content-control, malicious-input, selective-save, and save/reopen tests plus engine-core typecheck.

## 2. Contextual ProseMirror projection and enforcement

- [ ] 2.1 Add binding tests proving a contextually read-only canonical paragraph projects as an atom, a safe sibling remains editable, and forged/retyped/moved/duplicated read-only nodes are rejected without a revision change.
- [ ] 2.2 Thread the body access policy into model projection and reverse mapping so atom and editable-paragraph matching validate semantic identity, canonical kind, and policy membership instead of inferring access solely from block kind.
- [ ] 2.3 Add partial-mode transaction tests for safe in-place run edits and rejection of split, join, insert, delete, reorder, multi-paragraph paste, and replacements crossing a read-only boundary.
- [ ] 2.4 Implement the authoritative partial-mode operation allowlist before `DocumentStore.apply`, and disable corresponding edit-surface structural key paths as a user-experience guard.
- [ ] 2.5 Verify binding projection/reconciliation, read-only-block, edit-surface, undo/redo, clipboard, and binding typecheck suites.

## 3. Session, editor, and public diagnostics

- [ ] 3.1 Add session tests for mixed-body open, effective editing, undo/redo of in-place changes, selective save/reopen, wholly read-only original-byte save, and preservation-parse fallback remaining non-editable.
- [ ] 3.2 Update `DocxEditorSession` to expose document mode, structural-mutation allowance, and all structured diagnostics; mount editing for partial mode and route partially edited saves through `writeDocx`.
- [ ] 3.3 Extend the public editor snapshot with document capability mode, structural-mutation allowance, and read-only regions while preserving `editable` as the effective editor-level boolean after view/shared restrictions.
- [ ] 3.4 Thread the session policy through `createEditor`, document-handle sharing, snapshots, and `EditorDriver`; verify policy recomputation or revision validation prevents stale access after canonical changes.
- [ ] 3.5 Update TSDoc, public consumer type tests, API Extractor snapshots, and package exports for the additive diagnostics contract.

## 4. Mixed-content conformance and adapter parity

- [ ] 4.1 Add bounded fixtures containing safe paragraphs around a table, a block content control, and a paragraph with unsupported inline figure/object OOXML; include external/executable relationship cases that assert zero fetch or execution.
- [ ] 4.2 Add exact uncompressed-part and semantic-container assertions proving safe edits survive save/reopen while every read-only source slice, unowned byte sequence, relationship, media payload, and relative block order remains unchanged.
- [ ] 4.3 Add paired React/Vue tests proving identical mode, diagnostic identities, editable regions, structural-command gating, boundary rejection, and save results without adapter-side OOXML classification.
- [ ] 4.4 Update the OOXML feature/conformance manifest only for the partial-editing and structured-diagnostic evidence actually proven; do not upgrade unsupported figure rendering or inline-edit claims.
- [ ] 4.5 Add the required consumer-facing changeset for the additive editor diagnostics and partial-editing behavior.

## 5. Final verification

- [ ] 5.1 Run focused engine-core, engine-binding, engine-editor, React, Vue, and mixed-fixture tests.
- [ ] 5.2 Run `bun run typecheck`, `bun test`, `bun run check:parity`, `bun run api:check`, and the relevant conformance checks; resolve all regressions attributable to this change.
- [ ] 5.3 Run formatting and confirm the change satisfies every scenario in `specs/partial-body-editability/spec.md`, with inline same-paragraph editing and local structural regeneration still explicitly unclaimed.
