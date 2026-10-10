## Context

Today the docx-editor has two rendering models running simultaneously:

- **Body**: hidden ProseMirror EditorView at `left: -9999px` (`packages/react/src/components/DocxEditor/OffscreenEditorHost.tsx`) plus a visible painter (`packages/core/src/painter-model/paintPage.ts`). Click on the painter → `resolveDomPosition` → PM `setSelection` → painter re-renders. One renderer, true WYSIWYG.
- **Headers/footers**: same painter for normal display, but on double-click `InlineHeaderFooterEditor.tsx` (~513 lines) mounts a **second visible PM EditorView** on top of the painter. CSS hides the painted HF region during edit; PM's native `toDOM` tables become the visible layer. The two pipelines disagree about column widths, vertical alignment, line-box height, and row distribution — issue #468 already took three CSS patches to bring them visually closer.

Two reviewer agents (code architect + OOXML specialist) independently concluded the architectural fix is to put HF editing on the body's hidden-PM + visible-painter model. The OOXML reviewer specifically warned against the "make the painter editable, no PM" alternative (would force us to re-invent selection / IME / undo / a11y in the painter — neither Word nor LibreOffice nor Google Docs took that path).

This design proposes the concrete shape of that unification. It is intentionally incremental — each phase ships a working state, the long-lived branch only merges once all phases are green.

## Goals / Non-Goals

**Goals:**

- One visible renderer for header/footer content in both edit and display modes (the painter).
- Hidden PM EditorView per HF slot, mounted persistently, focused on click-into-HF — same model the body uses today.
- Click routing: clicks inside `.layout-page-header` / `.layout-page-footer` translate to PM positions on the matching HF PM via slot-scoped `resolveDomPosition`.
- Selection overlay: carets and selection rects render against the focused HF PM's state inside painted HF DOM, using existing `data-doc-from` / `data-doc-to` markers.
- Deletion of `.hf-editor-pm` CSS patches (the #468 strut suppression, column-width hacks, vAlign mapping) by construction — they no longer have a job once both modes use the painter.
- React + Vue architectural parity per CLAUDE.md's parity rule.
- Each phase is independently mergeable to the long-lived feature branch with green tests; rollback at any phase boundary returns to a working state.

**Non-Goals:**

- Changing the Document storage model. The runtime source of truth is `Document.package.headers: Map<string /* rId */, HeaderFooter>` and `.footers` (declared at `packages/core/src/types/document.ts:192-195`, populated by `headerFooterParser.buildHeaderFooterMap`, read by `sectionGeometry.resolveHeaderFooter`, written by `rezip/packaging.ts`). This rId-keyed model is the spec-faithful representation per ECMA-376 §17.10.1/§17.10.5 — headers are distinct parts referenced from `sectPr` via `r:id`, and merging them into one PM tree would break `r:id` sharing on save. (Note: `Section.headers`/`.footers` is also declared in `packages/core/src/types/content/section.ts:192-194` but is dead code — no parser populates it, no consumer reads it. Deletion is out of scope for this change.)
- Rewriting `prosemirror-tables`. PM's table model stays; only the _visible rendering_ changes (becomes the painter's `<div class="layout-table">` instead of PM's native `<table>`).
- Changing OOXML serialization. `packages/core/src/docx/serializer/headerFooterSerializer.ts` per-part dispatch stays exactly as it is.
- New HF features. Goal is parity with current capabilities.
- Unifying body and HF into one PM doc (Option B from the code reviewer's analysis). The decision is "one persistent hidden PM per HF slot," not "one merged PM containing body + HF + footnotes." Per-page reflow, section-keyed inheritance, and `titlePg`/`evenAndOddHeaders` semantics are far easier to model with separate PMs that share the painter.
- Migrating the editor's body model. Body editing stays exactly as it is; HF model is conformed _to_ the body's model.

## Decisions

### 1. One hidden PM EditorView per distinct HF part — keyed by `rId`

**Chosen:** Maintain one EditorView per distinct HF part in `Document.package.headers ∪ package.footers`, keyed by `rId`. Two sections that share a header by referencing the same `rId` (the §17.10.1 sharing-by-reference pattern) share one EditorView. Two sections with `default`-type headers that point to different `rId`s get two EditorViews. The `(hdrFtrType, kind)` tuple is _not_ the slot key — that would incorrectly conflate distinct parts that happen to share a type, and would fork shared parts that should stay unified.

The `evenAndOddHeaders` document-level setting (§17.15.1.45) does not affect PM mounting: if an `even`-type part exists in `package.headers`, its PM is mounted regardless of the setting (the setting controls whether the painter consults that PM at paint time, not whether the EditorView exists).

When a new HF part is materialized at runtime (e.g., the user toggles `titlePg` on and triggers creation of a "first" header), a new PM EditorView for the new `rId` is mounted lazily and persists thereafter.

**Alternatives considered:**

- **One merged PM doc containing body + HF subtrees.** Closer to "one canvas, one undo stack" (Word's UX). Rejected because (a) header images live in `word/_rels/header*.xml.rels`, document images in `word/_rels/document.xml.rels`, and a merged PM would need every node to carry a `partOwner` attribute to route on save; (b) footnote refs are forbidden in headers per §17.11.4 schema, so a merged doc forces schema-level content restrictions that don't match PM's normal model; (c) section-keyed inheritance (a section omitting a `headerReference` inherits from the previous section per §17.10.1) becomes opaque inside one tree.
- **One PM per `(sectionId, hdrFtrType, kind)` slot.** Rejected because it forks shared parts: two sections referencing the same `rId` would get two PMs holding the same content, and edits in one wouldn't propagate to the other without explicit sync. Also wastes EditorViews for documents with many sections sharing one header. The OOXML reviewer specifically flagged this as wrong.

**Rationale:** Per-rId mirrors the storage model (`package.headers` is already a `Map<rId, HeaderFooter>`), mirrors the serializer (one part out per `rId`), and matches Word's internal model (one editing context per header part). Undo stacks are naturally per-rId (matches Google Docs — undo inside a header doesn't affect the body and vice versa). Editing a shared header from any of its painted instances propagates to every other painted instance because they all read from the same PM doc.

### 2. Painter is the only visible HF renderer

**Chosen:** Painter renders `.layout-page-header` / `.layout-page-footer` in both edit and non-edit modes. The hidden PM EditorView lives off-screen and never has visible DOM the user sees.

**Alternatives considered:**

- **Painter visible normally, PM visible during edit (current state).** The whole reason this proposal exists. Rejected.
- **PM visible normally, painter never used for HF.** Would require PM's `toDOM` to match Word's layout — exactly what the `.hf-editor-pm` CSS patches have been failing to do. Rejected.
- **Painter renders, but make it directly editable with `contenteditable`.** Re-invents selection, IME, undo, accessibility. Both reviewers explicitly warned against this.

**Rationale:** Body's model is proven. Painter handles per-page reflow (page numbers, `titlePg` swap) by re-running `renderHeaderFooterContent` per page; that doesn't change.

### 3. Click routing via slot-scoped `resolveDomPosition`

**Chosen:** Extend `usePagesPointer.handlePagesMouseDown` to detect the clicked HF region (header/footer + page + section) and call a slot-scoped variant of `resolveDomPosition` that queries only that slot's painted DOM. Resolves to a PM position in the matching HF PM. Sets focus on that PM via `view.focus()`.

**Alternatives considered:**

- **Single global `resolveDomPosition` with a multi-PM lookup.** Cleaner caller, but the hit-test query mixes body and HF DOM ranges. The scoped variant matches the existing pattern: `collectBodySpans` already scopes to `.layout-page-content` (`packages/core/src/flow-model/collectBodySpans.ts:13-15` — the comment literally says HF callers "should write their own queries scoped to those classes").

**Rationale:** Scoped queries are the existing pattern in `collectBodySpans`. The same convention applied to HF means no new architectural primitive — just a sibling helper `findHfPmSpans(slot)`.

### 4. Selection overlay extends with a per-PM overlay layer

**Chosen:** `useSelectionOverlay` (or a parallel `useHfSelectionOverlay`) draws carets and selection rects against the focused HF PM's state inside painted HF DOM, using the painter's existing `data-doc-from` / `data-doc-to` markers. Only the focused PM draws an overlay at a time.

**Alternatives considered:**

- **Native `contenteditable` selection on painted DOM with a `nodeView` per PM.** Possible but requires a custom PM nodeView per HF block; loses simplicity.
- **Two overlays simultaneously (body + HF).** Could draw faded body selection alongside HF selection. Rejected as a v1 goal — neither Word nor Google Docs do this; can revisit later.

**Rationale:** Keeps the overlay drawing one-PM-at-a-time, matching the body's model. The painter already emits the markers we need.

### 5. PM doc as projection of Document model (not source of truth)

**Chosen:** `Document.package.headers/footers` (`Map<string /* rId */, HeaderFooter>` at `packages/core/src/types/document.ts:192-195`) remain the source of truth for storage. The HF PM doc is a _projection_ built once at mount via `headerFooterToProseDoc(package.headers[rId].content, …)`, kept in sync via PM transactions, and serialized back to `package.headers[rId].content` on each transaction (or debounced).

**Alternatives considered:**

- **PM as source of truth, Document derived.** Cleaner editor model, but breaks round-trip for documents that never had their headers edited — the user can save without ever opening any HF editor, and Document should be unmutated for those. Also doesn't match what the body editor does today (body PM is canonical for body content while loaded, but Document is canonical for everything that hasn't been edited).

**Rationale:** Matches the body's pattern (body PM is canonical-while-loaded for the body subtree; Document map stays canonical for HF until edited). Save path: `proseDocToBlocks(hfPM.state.doc)` → `Document.package.headers[rId].content` (or `.footers[rId].content`). This is exactly what `useHeaderFooterEditing.ts` does today on close; the change is timing (every transaction, debounced) and trigger (no longer tied to overlay unmount).

### 6. Toolbar / focus management via `useActiveEditor`

**Chosen:** Reuse the existing `useActiveEditor` hook to route toolbar commands (bold, italic, format dropdowns, undo/redo) to whichever EditorView currently has focus. Today this hook already handles body-vs-HF switching; it just needs the HF reference to come from the persistent hidden PM instead of the soon-to-be-deleted overlay PM.

**Alternatives considered:**

- **Per-toolbar-instance routing.** Rejected — already solved.

**Rationale:** This is one of the few pieces of plumbing that's already in place. No new design needed.

### 7. Vue parity is mandatory, centralized into core where possible

**Chosen:** Land the React changes first to validate the model, then port to `packages/vue/src/composables/useDocxEditor.ts`. Where the new abstraction is platform-agnostic (e.g., `findHfPmSpans` helper, the projection sync logic), centralize into `packages/core/`. The float-zone pipeline in `packages/core/src/flow-model/metrics/measureBlocksPipeline.ts` is the canonical example to mirror.

**Rationale:** CLAUDE.md's parity rule explicitly demands this. The parity contract gate (`bun run check:parity-contract`) will block merge to main until both adapters are aligned.

## Risks / Trade-offs

- **Multiple undo stacks** → Each HF PM has its own history. Toolbar undo/redo must follow focus. The existing `useActiveEditor` already handles this; needs verification it works when the "active editor" is a hidden HF PM (it should — `EditorView.focus()` doesn't care about visibility, only that the DOM is in the document).
- **IME / native focus** → Only one EditorView can hold native browser focus at a time. Click-into-HF must move focus correctly. The body's hidden PM already proves this works at `left: -9999px`. Switching focus via click in the painter is the same pattern.
- **Per-page reflow drift** → Painter re-runs `renderHeaderFooterContent` per page (page number fields, `titlePg` first-page swap). PM is one logical instance; painter still instantiates N visual instances. No change to painter logic — just verify it still works when its source is `hfPM.state.doc` instead of `headerFooter.content`.
- **Field codes** → `PAGE` / `NUMPAGES` fields must continue to resolve at paint time, not be cached in PM. Already the case; verify it survives.
- **Image relationships in HF** → Per ECMA-376 Part 2 §9.2, header images live in `word/_rels/header*.xml.rels`. Storage model unchanged, so per-part `.rels` files stay; serializer keeps routing correctly.
- **Cross-section header sharing by `rId`** → Storage model unchanged; sections that share a header by `rId` continue to share. The projection layer must not fork shared parts (one PM per `rId`, not one per `(sectionId, type)`). Editing a shared header from section 1's painted instance must update section 2's painted instance within one layout pass — a playwright spec must assert this (see tasks.md phase 1).
- **Runtime section break insertion** → A new section omitting `headerReference` inherits the previous section's `rId` per §17.10.1. `applySectionInheritance` (`packages/core/src/docx/sectionParser.ts:828`) already flattens this at parse time; runtime inserts should copy the parent's flattened refs. The PM model handles this naturally: the new section's painted HF resolves the inherited `rId` to the same `HeaderFooter` object and reuses the existing PM EditorView. No new mounts needed.
- **Click-to-HF unintentionally steals focus from body** → Need to verify that double-click is still required to enter HF edit mode (current UX), or whether single-click should suffice now that there's no overlay-mount cost. Decision deferred to phase 5 UX review.
- **Phase 3 (click routing) and Phase 4 (selection overlay) are the riskiest steps** → They touch hot paths for body editing. Bug in `usePagesPointer` could break body clicks. Mitigation: each phase keeps the inline overlay (and its visible PM) intact until phase 5 deletes it — so even if phase 3/4 routing has bugs, users can still edit via the overlay until phase 5.
- **The `_hf-editor-pm` CSS deletion is the load-bearing step** → Deleting it before phase 2 unhides the painter would leave HF unstyled. Strict ordering: phase 2 first, phase 5 deletes CSS.
- **Rolling back mid-refactor** → Each phase is mergeable to the feature branch with a green test suite. If a later phase reveals the design is wrong, revert that phase only; earlier phases remain shipped on the branch.
- **Tests** → A new screenshot-diff playwright spec must assert zero geometry change between edit and non-edit modes on `DC_Template_Descricao_Cargo_Controlado_Enterprise.docx`. Without it, this whole refactor lacks a single-bit verification of its central claim.

## Migration Plan

The change lands on a long-lived feature branch (`refactor/unify-hf-editing`). Each phase is a separate PR against that branch:

1. **Persistent hidden HF PM** — Move `EditorView` creation out of `InlineHeaderFooterEditor`'s mount path into a hook that mounts always when HF content exists. Painter consumes `hfPM.state.doc`. Inline overlay UX unchanged (still visible on double-click).
2. **Painter shows through during edit** — Delete `.paged-editor--editing-{header,footer} .layout-page-{header,footer} > * { visibility: hidden }`. Move overlay PM to `left: -9999px`. Visual difference between modes vanishes at this point. #468 CSS patches become deletable.
3. **Click routing** — Extend `usePagesPointer` to route HF clicks to HF PM. Add `findHfPmSpans(slot)`.
4. **Selection overlay** — Extend `useSelectionOverlay` for HF PM. Carets visible in painted HF.
5. **Delete the visible inline PM** — Remove the `.hf-editor-pm prosemirror-editor` container, the PM creation in `InlineHeaderFooterEditor`, all `.hf-editor-pm` CSS. Inline overlay shrinks to UI chrome only (~50 lines).
6. **Vue parity** — Same architecture in `useDocxEditor.ts`. Parity contract green.
7. **Cleanup** — Remove now-dead state in `useHeaderFooterEditing.ts`, simplify `hfEditPosition` semantics, drop unused helpers.

**Rollback strategy:** If phase 5 reveals a regression too late to fix in phase, revert phase 5 only — the inline overlay PM and its CSS patches return, but phases 1–4 stay landed (their work is independent improvements). If phase 2 has an issue, revert phase 2 only — the painter goes back to being hidden during edit but the persistent HF PM stays.

**Feature flag:** Not used. Each phase is small enough that flagging the half-states would be more risk than just landing them and reverting if needed.

## Open Questions

- **Does single-click into a header suffice now, or do we keep requiring double-click?** Today double-click is the affordance because mounting the overlay was expensive. With persistent PM, single-click could work — but it might confuse users who accidentally click near the header margin. Decide in phase 5.
- **Selection overlay: extend `useSelectionOverlay` or fork `useHfSelectionOverlay`?** The body overlay does a lot more (sidebar comment markers, change-tracking highlights, etc.) — some of that might apply to HF, some might not. Punt until phase 4; will pick the cleaner option once we see the actual diff size.
- **Does the persistent HF PM need a separate `ExtensionManager` instance, or can it share the body's?** PM plugins are keyed — sharing might break history (each EditorView needs its own history plugin instance). Today the inline editor creates a fresh `ExtensionManager` per mount (`InlineHeaderFooterEditor.tsx:217-222`). We'll do the same per HF PM in phase 1.
- **Cross-PM image attribution.** Pasting an image into a header (or dragging from body to header) must serialize the image into `word/_rels/headerN.xml.rels`, not `word/_rels/document.xml.rels` (ECMA-376 Part 2 §9.2). The rId-keyed PM model handles this implicitly: each EditorView's doc is serialized into `package.headers[rId].content`, and the per-part serializer walks that content for drawings and emits relationships into the right `_rels` file. Cross-PM drag (body → header) requires content transplant; verify this in phase 3 testing.
- **Insert Footnote toolbar guard.** §17.11.4 schema forbids `<w:footnoteReference>` inside `w:hdr`/`w:ftr`. PM schema doesn't currently enforce this. Add a cheap toolbar-level guard in phase 5: "Insert Footnote" disabled when focus is in an HF PM. Schema-level enforcement is a separate follow-up.
- **Footnotes in headers** → Currently disallowed by ECMA-376 schema. Today the inline editor doesn't enforce this. The unification is a good moment to add a schema-level guard against `<w:footnoteReference>` inside HF content — but it's an additive correctness fix, not strictly required for this refactor. Track as a separate ticket.
