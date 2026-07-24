## Context

The production session currently calls `diagnoseBodyPatchability` once and reduces the result to a body-wide boolean. A table, block content control, missing source range, non-contiguous block sequence, or paragraph that is not fully captured therefore prevents the ProseMirror surface from mounting.

This policy is stricter than the lower layers require for in-place edits. Preservation already indexes top-level source ranges, re-emits unchanged ranges verbatim, and patches a changed paragraph only after its original slice passes the lossless-capture guard. The binding already projects non-paragraph blocks as identity-bound atoms and rejects their disturbance. The missing piece is a shared per-block access policy that also handles a semantic `paragraph` whose source slice contains unowned inline OOXML.

Unsupported figures are commonly inline children of `w:p`. Until ownership-scoped inline capsules are implemented, editing text inside that same paragraph would require regenerating a slice containing content the semantic model does not own. This change therefore treats the whole containing paragraph as read-only while permitting in-place edits in safe sibling paragraphs.

## Goals / Non-Goals

**Goals:**

- Derive full, partial, or no body editability from preservation evidence for each top-level block.
- Keep canonical block kinds semantic; a paragraph remains a paragraph even when its current source slice is read-only.
- Project every read-only block as an immutable, identity-bound boundary while
  keeping each capability-owned block with a proven selective-save path
  editable.
- Guarantee before canonical commit that every operation allowed in partial mode has a lossless selective-save path.
- Preserve read-only ranges and unrelated package parts verbatim after editing a safe neighbor.
- Expose structured region diagnostics consistently to headless consumers and both browser adapters.

**Non-Goals:**

- Editing text within a paragraph that also contains an unsupported inline child.
- Ownership-scoped inline preservation capsules.
- Rendering or semantically editing figures, tables, or content controls that
  lack their own complete capability and selective serializer.
- Structural top-level body operations in a partially editable body.
- Locally regenerating a patchable run of blocks between read-only boundaries.
- Changing trust-boundary failures into read-only opens.

## Decisions

### 1. Derive a contextual body access policy instead of changing canonical block kinds

`diagnoseBodyPatchability` becomes a richer assessment that reports:

- `mode: 'full' | 'partial' | 'none'`
- the patchable top-level block IDs
- one structured diagnostic for each read-only block or body-level preservation constraint
- whether structural body mutation is allowed

Patchability is contextual evidence from the current preservation snapshot, source range, capability ownership, and serializer. It is not an intrinsic property of `ParagraphRecord`, so the canonical union will not gain a `verbatimParagraph` or generic opaque block solely for editor policy.

Body-level failures such as no preservation snapshot, no document part, or source ranges whose integrity cannot be established produce `mode: 'none'`. A non-contiguous block sequence also disables structural mutation; it does not need to disable an independently patchable paragraph's in-place edit when the changed range can still be patched without replacing inter-block bytes.

Alternative considered: parse unsafe paragraphs into a new read-only block kind. This would fit the existing generic atom path, but it would make semantic identity depend on the installed editor's current serialization coverage and would discard useful paragraph semantics from layout and queries.

### 2. Make projection and reverse mapping consult the same immutable policy

The session constructs `EditorBinding` with the body access policy for the loaded model revision. A patchable paragraph uses the editable paragraph projector. Any read-only block, including a `paragraph`, uses the atom projector with its stable semantic ID and canonical kind.

Atom matching will validate identity, canonical kind, and membership in the binding's read-only ID set. It will no longer infer atom validity solely from `block.kind`. Editable paragraph matching likewise requires membership in the patchable ID set. One policy therefore governs both forward projection and reverse reconciliation.

The policy is recomputed after canonical changes that can affect block identity or preservation evidence. Partial mode initially permits no such structural changes, so normal text edits retain the same classification.

Alternative considered: put a `readOnly` flag on ProseMirror attrs and trust it during reverse mapping. Rejected because projection data is untrusted reconciliation input; the binding must validate against canonical policy by semantic ID.

### 3. Allow only capability-owned edits inside one patchable block in partial mode

In partial mode the binding may emit only operations claimed by the patchable
block's installed capability and proven reproducible by its selective
serializer. The initial lane is in-place paragraph run editing. A later fully
owned table or other structural block may permit its own internal operations
while unrelated top-level blocks remain read-only. Top-level body split, join,
insert, delete, reorder, multi-block paste, and any transaction crossing or
disturbing a read-only boundary are rejected before `DocumentStore.apply`.

Disabling structural key bindings improves UX, but the binding remains the authoritative guard because transactions may originate from plugins, clipboard handling, tests, or future adapters.

This top-level structural restriction matches the current serializer: a changed
body-block count invokes whole-region regeneration, which is intentionally
unavailable when any original block is not fully captured. Internal operations
within one fully owned top-level range are allowed only when that capability can
replace or patch the exact range and update its preservation evidence safely.
Local top-level structural editing between read-only boundaries remains
deferred until preservation can replace a bounded contiguous run and update its
range index safely.

### 4. Keep selective serialization authoritative and eliminate normalization false positives

A partially editable session saves through `writeDocx`, not by returning the original bytes. `emitPreservedPart` continues to:

- verify source and baseline hashes,
- emit unchanged ranges verbatim,
- invoke only the registered capability patcher/serializer for a changed safe
  top-level block, and
- fail closed rather than regenerate unowned content.

Before partial mode is claimed, preservation baseline comparison must use the same deterministic normalized semantic form as the store. Store normalization must not make an untouched preserved block appear edited. Tests will cover opening, editing a different paragraph, saving, and reopening fixtures whose untouched blocks normalize internally.

The binding operation allowlist is a pre-commit serialization proof. Save-time guards remain defense in depth, not the first point at which an accepted edit can be rejected.

### 5. Add structured capability diagnostics, not unconditional console output

Diagnostics extend the existing `ReadOnlyDiagnostic` shape and include stable story/block identity where applicable, block kind/root QName, a reason code, and the missing pipeline lane. A capability ID is included when registry evidence identifies one. Body-level failures remain distinguishable from region-level restrictions.

`DocxEditorSession` exposes the document mode, structural-mutation allowance, and all diagnostics. The public `EditorSnapshot` adds the document capability mode and read-only regions while retaining `editable` as the effective boolean after document policy, configured view mode, and shared-view restrictions:

- full or partial document in an owning edit-mode editor: `editable: true`
- no editable region, configured view mode, or shared read-only view: `editable: false`

Hosts may display, collect, or log these diagnostics. Core packages do not write file-derived warnings directly to the global console.

### 6. Keep adapter behavior thin and paired

React and Vue consume the same editor snapshot. They do not classify OOXML independently. For one fixture they must expose the same mode and diagnostic identities, mount the same editable regions, and reject the same boundary-crossing transactions.

Rendering remains sourced from the canonical layout pipeline. A read-only paragraph may still lack visual output for an unsupported child until the relevant drawing lane lands; partial editability does not upgrade its rendering-support claim.

## Risks / Trade-offs

- **A read-only paragraph atom may provide a poorer editing view than the painted document** → Keep canonical layout visible and use a typed read-only node view/overlay rather than pretending the unsupported child is editable.
- **A ProseMirror plugin creates a structural transaction despite disabled key bindings** → Enforce the partial-mode operation allowlist in reverse mapping before store commit.
- **Policy and projection diverge after a revision** → Key policy by canonical revision, recompute on relevant model changes, and validate every projected semantic ID against the current policy.
- **Normalization marks an untouched range as changed** → Align baseline hashing with store normalization and add unrelated-edit save/reopen fixtures before enabling partial mode.
- **A broad diagnostic API becomes unstable while feature lanes grow** → Use reason codes and optional capability metadata; do not expose parser-specific implementation objects.
- **Users assume partial editability includes same-paragraph editing around a figure** → Diagnose the containing paragraph as one read-only region and document inline capsules as a separate capability.

## Migration Plan

1. Add the per-block assessment while retaining `isModelBodyPatchable` as a compatibility projection of `mode === 'full'`.
2. Add binding policy input and tests for paragraph-kind atoms before relaxing the session gate.
3. Add the capability-owned partial-mode operation allowlist and
   normalization-safe preservation evidence, beginning with paragraph text.
4. Change session/editor policy so partial documents mount the editing surface and save through selective serialization.
5. Add public snapshot fields and paired adapter conformance fixtures.
6. Keep a rollback path by forcing partial assessments to `none`; existing wholly editable and wholly read-only behavior then remains available without changing stored documents.

## Open Questions

None. Inline same-paragraph editing and locally bounded structural mutation are explicitly deferred rather than left ambiguous.
