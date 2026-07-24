## Why

The editor currently applies one body-wide patchability gate, so one preserved table, content control, or paragraph containing unsupported inline OOXML makes every otherwise safe paragraph read-only. The existing block ranges and selective serializer can preserve unchanged neighbors verbatim, so the editing policy should expose that safety at block granularity without claiming unsupported content is editable.

## What Changes

- Classify each top-level body block as patchable or read-only and derive full, partial, or no body editability from those classifications.
- Keep paragraphs with unowned inline OOXML, including unsupported figures, as identity-bound read-only regions while allowing safe surrounding paragraphs to receive in-place text edits.
- Reject deletion, movement, replacement, or duplication of read-only regions before canonical commit.
- In the first partial-editing slice, reject all structural body edits when any top-level block is read-only so a committed operation cannot fail only when the document is saved.
- Save partially edited documents by patching only changed, proven-safe paragraph ranges and emitting every read-only block and unrelated package part verbatim.
- Expose structured, capability-oriented read-only diagnostics consistently through the session, public editor state, and paired adapters. Diagnostics are data for hosts to present or log, not unconditional console output.
- Add mixed-body edit, rejection, selective-save, reopen, and paired-adapter conformance evidence.
- Defer editing text within the same paragraph as an unsupported inline child until ownership-scoped inline preservation capsules exist. Drawing rendering and semantic editing of tables, content controls, and unsupported figures also remain out of scope.

## Capabilities

### New Capabilities

- `partial-body-editability`: Per-block body edit policy, immutable read-only projection boundaries, safe in-place editing of neighboring paragraphs, structured diagnostics, and lossless selective save/reopen behavior.

### Modified Capabilities

None.

## Impact

- `packages/engine-core`: per-block patchability assessment and preservation-backed diagnostics.
- `packages/engine-binding`: contextual read-only projection for paragraph-kind blocks, identity validation, and partial-mode operation gating.
- `packages/engine-editor` and the public editor contract: full/partial/none editability state and structured read-only-region diagnostics.
- `packages/react` and `packages/vue`: identical exposure of partial editability and blocked-region reasons.
- Preservation and conformance fixtures: mixed safe paragraphs, tables/content controls, and paragraphs containing unsupported inline OOXML.
- No new runtime dependency is required. The change builds on existing block-range preservation and remains compatible with the later ownership-capsule work in `document-engine`.
