# Design: pro package (review module + custom nodes)

## Context

All packages are Apache-2.0 and unpublished; the free/pro line can be drawn without migration. Review code today spans three layers: core layout (`review-model.ts` 957 lines, `comment-anchors.ts` 316, `revision-projection.ts`, `revision-visibility.ts`), core editor exec (review commands), and the React adapter (`DocxEditorReview.tsx` 1309 lines, `useReview.ts`). `RevisionDisplayMode` threads through nearly every layout file (paragraph-flow, tables, hf-layout, section-properties, story-roots, field-projection), while `review-model.ts` + `comment-anchors.ts` have only two core importers (`contracts/editor.ts` types, `binding/tree-session.ts` `collectReviewItems`). Block SDTs are flattened by `storyBlocks`; inline SDT modeling is a deferred lane that custom nodes now gives a customer.

## Goals / Non-Goals

**Goals:**

- Paid code physically and legally outside Apache-licensed packages.
- Free tier stays honest: lossless round-trip, correct final-state ("No Markup") rendering, no dead pro code in the free bundle.
- One narrow seam in core, designed once for both launch features; the one-pipeline principle survives.
- Word interop for custom nodes: anchors survive Word open→edit→save.

**Non-Goals:**

- A general plugin/extension framework (two known consumers do not justify one; generalize later if a third appears).
- Extracting revision projection/display-mode plumbing from layout (would fork the pipeline).
- Hard DRM. Enforcement is honest-company level (AG Grid model).
- Vue review chrome (Vue has none today; pro ships React chrome first, Vue sugar later).
- Server-side license validation or telemetry.

## Decisions

### D1: Purpose-built `EditorModule` seam, not a plugin system

`createDocxEditor({ modules?: EditorModule[] })`. `EditorModule` is a closed-shape interface with named contribution points: `reviewModel` (review item derivation + comment anchor geometry), `commands` (exec-layer contributions keyed by existing `ChromeSlotId`s), `displayModes` (unlocks `RevisionDisplayMode` values beyond final), `customNodes` (registered node definitions). Core defines the interface and iterates registered modules at the existing dispatch points; it never imports pro.

*Alternatives:* (a) pro wraps/replaces core entry points — rejected: pro would chase core internals every release and the one-pipeline principle dies; (b) full extension framework — rejected: YAGNI.

### D2: Display-mode machinery stays in core; gating is at the API layer

`RevisionDisplayMode`, projection, and visibility stay in layout (inseparable). Without a module granting modes, the editor never leaves final-state projection and no public API can switch modes. Accepted consequence: a determined fork of Apache core could re-enable markup rendering; the paid artifact is the review model, commands, and pane, which are genuinely absent from free packages.

### D3: What physically moves

To `packages/pro`: `review-model.ts`, `comment-anchors.ts` (clean lift, two importers), review command implementations from editor exec, `DocxEditorReview.tsx`, `useReview.ts`, review slot wiring. Stays in core: `ReviewItem`/anchor types in `contracts/` (the seam must be typed), chrome slot IDs (`review.comments`, `review.editingMode` — public API, renames are breaking), `hasReviewContent` (cheap tree scan for `w:ins`/`w:del`/comment refs, computed lazily and version-cached like other derived reads).

### D4: Free-tier degradation

No module: review slots render disabled with a new `pro` unavailable-reason (existing unwired-slot pattern), documents render final state, `hasReviewContent` still works so hosts can show an upsell hint. Nothing throws.

### D5: Custom nodes anchor on run-level SDTs with `w:tag`

**Verified by experiment (2026-08-05, Word for the web):** a probe doc with three run-level SDTs carrying non-standard tags (`docx:citation?sourceId=…`, `docx:mention?…`, `docx:chip?ref=cx1`), `sdtLocked` on two, plus a `customXml/item1.xml` data part was uploaded, edited, and re-saved in Word Online. All three tags, both locks, and the data part payload survived byte-intact in the rewritten package. Fixtures: `e2e/fixtures/sdt-custom-tag-original.docx` (pre-Word) and `sdt-custom-tag-word-roundtrip.docx` (Word Online output). A first probe additionally containing an inline `w:customXml` element was refused outright by Word Online.

Identity + attrs in `w:tag` (`<prefix>:<name>?<urlencoded attrs>`, 64-char Word limit; overflow goes to a customXml data part referenced by id — data parts survived the i4i ruling, inline `w:customXml` markup did not and is stripped by Word 2010+, which rules it out). `sdtLocked` is the default lock so Word users cannot casually unwrap the anchor while still editing the label. `fromDocx` keys on the tag prefix; `toDocx` builds SDT content through a ctx that routes URLs through `sanitizeHref`. Fallback in Word: the SDT renders its literal run content.

*Alternatives:* hyperlink-with-magic-URL (survives Word but hijacks a user-visible affordance and collides with real links — kept possible via `fromDocx`, not the blessed path); inline `w:customXml` (stripped by desktop Word 2010+; verified 2026-08-05 that Word for the web refuses to even open a document containing one — "this document can't be opened because it contains custom XML elements").

### D6: Framework-neutral render + measured extent; React is sugar

Core contract: `render(node) => { element: HTMLElement, extent: { width, height } | textEquivalent }` — layout is DOM-free and must know the extent before paint. The painted chip is a host element (`contenteditable=false`, data-attributed like other furniture). React sugar in pro: a portal component that mounts the integrator's JSX into the host element at the measured extent, so client code can still write `render: (node) => <CitationChip/>`. Extent changes require an explicit invalidation call, never observed reflow.

### D7: Atomic offset semantics

A custom node occupies the UTF-16 offsets of its underlying SDT run text under the single paragraph offset authority. Caret skips it as one unit, backspace/delete removes the whole SDT, copy/paste carries the underlying OOXML. Label drift (Word user edits the text, attrs unchanged) is surfaced to `fromDocx`, which chooses to keep or re-derive the label.

### D8: Licensing and packaging

`@docx-editor.dev/pro`, `"license": "SEE LICENSE IN LICENSE.md"`, in the fixed changeset group, peer-deps on core (+ react for chrome, optional); any registry works (public npm by default). v1 licensing is honor-system: `licenseKey` is accepted but unvalidated (owner decision 2026-08-05), so adding Ed25519 verification later is non-breaking. Never a network call, never crippling.

## Risks / Trade-offs

- [Seam becomes de-facto public API pro must track] → keep `EditorModule` closed-shape and versioned with the fixed group; only pro implements it at launch.
- [`review-model` lift breaks `tree-session`/contract importers] → types stay in `contracts/`; `collectReviewItems` call sites go through the module registry with a null-object default.
- [Custom-node extent drift breaks pagination] → extent is a contract input, re-measured only on explicit invalidation; painted host clips overflow.
- [64-char `w:tag` overflow] → data-part escape hatch is part of the v1 contract, not a follow-up.
- [Attacker-controlled attrs in crafted DOCX reach integrator `render`/`onHover`] → documented as untrusted input; ctx builders sanitize URLs; host element built via `createElement`, never HTML-from-strings.
- [Parity/API churn] → parity contract gains a pro bucket; API Extractor snapshots re-extracted in the same PR as the lift.

## Open Questions

- **`@docx-editor.dev/agents` still exposes ungated review authoring** (addComment/proposeChange tools over store ops, Apache-licensed) — flagged by branch review 2026-08-05. The headless agent lane predates the split and is not covered by this change's scope; owner must decide before shipping whether agents' review tools move behind the module gate, move into pro, or stay free as an agent-lane exception. Recorded here so the hole is a decision, not an accident.


- ~~Key signing scheme~~ Resolved: Ed25519-signed payload (`DOCXPRO.<base64 org/tier/expiry>.<signature>`), public key embedded in the package, verified offline, never a network call. Expiry gates release dates (versions published while licensed keep working forever), not runtime.
- Whether `hasReviewContent` should also count custom-node SDTs or stay review-only (leaning review-only).
