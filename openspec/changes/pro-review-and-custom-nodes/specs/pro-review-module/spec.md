# pro-review-module Specification (delta)

## ADDED Requirements

### Requirement: Review module delivers review functionality via the seam

`@docx-editor.dev/pro` SHALL export `reviewModule(options)` returning an `EditorModule` that contributes: review item derivation (review model + comment anchor geometry), markup/original display modes, and commands for accept, reject, reply, add-comment, and toggle-track-changes. The implementation SHALL live in `packages/pro`; Apache-licensed packages SHALL NOT contain the review model derivation, review commands, or review pane after the lift.

#### Scenario: Registered review module unlocks review

- **WHEN** `createDocxEditor({ modules: [reviewModule({ licenseKey })] })` opens a document with tracked changes
- **THEN** markup display mode is available, review items are derived, and accept/reject/reply commands execute through the standard exec path

#### Scenario: Free packages contain no review implementation

- **WHEN** the published `@docx-editor.dev/core-contract` and `@docx-editor.dev/react` artifacts are inspected
- **THEN** they contain no review model derivation, review command implementations, or review pane code

### Requirement: Review mutations go through the single write path

All review commands SHALL mutate the document exclusively through `TreeDocumentStore.transact` over `TreeDocOp`s, preserving losslessness for untouched content. Accepting an insertion SHALL unwrap it; rejecting an insertion SHALL remove it; accepting a deletion SHALL remove the content; rejecting a deletion SHALL restore it; replies SHALL be written as comments (OOXML revisions have no reply body).

#### Scenario: Accept insertion round-trips

- **WHEN** an insertion revision is accepted and the document is saved and reopened
- **THEN** the content persists as ordinary runs, the `w:ins` wrapper is gone, and the semantic digest of untouched content is unchanged

### Requirement: React review pane ships in pro

The review sidebar (`DocxEditorReview`, `useReview`) SHALL be exported from the pro package and wire the `review.comments`/`review.editingMode` chrome slots when mounted inside `DocxEditor.Root`. It SHALL follow the adapter chrome rules (single-source stylesheet tokens, mousedown `preventDefault`, i18n via `t()`).

#### Scenario: Pane wires review slots

- **WHEN** the pro review pane is mounted with a licensed review module
- **THEN** review slots become enabled and the pane lists derived review items with reply/accept/reject actions
