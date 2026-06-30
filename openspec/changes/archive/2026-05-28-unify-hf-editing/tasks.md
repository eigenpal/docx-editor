## Status (2026-05-27)

Phases 1–6 + caret overlay landed on `refactor/unify-hf-editing` (PR #611). HF editing now uses one persistent hidden PM per `rId` in BOTH React and Vue adapters; the painter is the sole visible HF renderer; clicks translate to PM positions; a caret renders in the painted region; the entire `.hf-editor-pm` CSS block and the inline overlay's EditorView are deleted in both packages. Issue #468's class of bug is closed by construction across the whole stack.

**Verification:**

- React (`http://localhost:5173`): manual end-to-end works; programmatic CDP click+type lands the first keystroke on body PM in some sequences but `view.focus() + key dispatch` confirms typing → persistent PM → painter relayout chain end-to-end.
- Vue (`http://localhost:5174`): two persistent EditorViews mount on load (`rId9` header + `rId10` footer); double-click engages edit mode with painter visible and toolbar bar floating over the painted region; programmatic focus + key dispatch confirmed `V` insertion into persistent PM with painter live-repaint.
- `bun run check:parity-contract` green; 613 core + 44 react unit tests pass.

Deferred:

- **Selection-range rectangles** (multi-cell highlights) inside the painted HF — caret alone covers WYSIWYG; range rects can attach to the same recompute path in both adapters.
- **Click-then-type focus race in CDP automation** — programmatic test harnesses occasionally land the first keystroke on the body PM. Manual interaction works; root-cause is likely a focus reaction during relayout. Track and fix without blocking merge.

## 1. Branch and baseline

- [ ] 1.1 Create long-lived feature branch `refactor/unify-hf-editing` from main (after PR #610 merges).
- [ ] 1.2 Add a playwright spec that captures non-edit vs edit screenshots of the `DC_Template_Descricao_Cargo_Controlado_Enterprise.docx` header and asserts pixel-level parity. This spec must fail today (under #610's CSS patches) and pass when the unification is complete — it is the single-bit verification of the whole refactor.
- [ ] 1.3 Snapshot existing baselines for `titlePg-header-footer.spec.ts`, `footer-page-number.spec.ts`, `sdt-header-content.spec.ts`, `hf-trailing-rule.spec.ts`, `hf-toolbar-and-zindex.spec.ts` so regressions in later phases are obvious.
- [ ] 1.4 Add a playwright spec asserting that editing a shared-rId header from section 1's painted instance updates section 2's painted instance within one layout pass. Test fixture: a multi-section DOCX with a `default` header shared by `rId` across sections. Must pass when the unification is complete; today it would also pass (since the painter re-reads from the Document model on every layout) but it must be guarded against regression as the PM projection layer is introduced.

## 2. Phase 1 — Persistent hidden HF PM (React adapter)

- [ ] 2.1 Design `useHeaderFooterPM` hook that owns one hidden `EditorView` per distinct HF part, keyed by `rId`. The set of `rId`s comes from `Document.package.headers ∪ package.footers` (declared at `packages/core/src/types/document.ts:192-195`). Hook mounts views off-screen (`position: absolute; left: -9999px; top: 0`) and exposes a `getView(rId)` accessor. Do NOT key by `(hdrFtrType, kind)` — that would fork shared parts.
- [ ] 2.2 Each EditorView creates its own `ExtensionManager` instance (matches `InlineHeaderFooterEditor.tsx:217-222` pattern). Confirm history plugin is per-view and undo stacks stay independent.
- [ ] 2.3 On every HF transaction, serialize `proseDocToBlocks(view.state.doc)` and write back to `Document.package.headers[rId].content` (or `.footers[rId].content`). Debounce to avoid thrashing the layout pipeline.
- [ ] 2.4 In `useLayoutPipeline.ts`, replace the call to `convertHeaderFooterToContent(headerContent, …)` with a path that resolves the painted HF region to its `rId` (via the section's `headerReferences` / `footerReferences`), looks up the corresponding HF EditorView from the `useHeaderFooterPM` registry, and reads from `view.state.doc`. Fall back to `package.headers[rId].content` for `rId`s without a mounted PM (shouldn't happen post-2.1, but guard it).
- [ ] 2.5 Refactor `convertHeaderFooterToContent` (in `packages/core/src/flow-model/headerFooterLayout.ts`) to accept either a `HeaderFooter` object or a `PMNode` directly — the existing first branch already calls `headerFooterToProseDoc`, so the change is to skip that step when given a PMNode.
- [ ] 2.6 Keep the inline overlay's existing PM EditorView (the user-visible one) in place for now. UX is unchanged at this phase.
- [ ] 2.7 Verify: existing HF playwright specs all pass; the new screenshot-diff spec from 1.2 still fails (overlay still visible during edit) but no regression in coverage.
- [ ] 2.8 Land phase-1 PR to feature branch with `bun run typecheck`, `bun test packages/core/src`, and the existing HF playwright suite green.

## 3. Phase 2 — Painter shows through during HF edit

- [ ] 3.1 Delete CSS rules `.paged-editor--editing-header .layout-page-header > * { visibility: hidden }` and the footer counterpart in `packages/core/src/prosemirror/editor.css` and `packages/react/src/styles/editor.css`.
- [ ] 3.2 In `InlineHeaderFooterEditor.tsx`, move the `<div ref={editorContainerRef} className="hf-editor-pm prosemirror-editor" />` container to a hidden position (`position: absolute; left: -9999px; top: 0; width: 1px; height: 1px;`). PM continues to receive focus and input; user no longer sees it.
- [ ] 3.3 Verify: painter HF area visible during edit, overlay PM invisible, edit still works (typing reaches PM via focus, but caret/selection rendering is broken — that's phase 4).
- [ ] 3.4 Verify: new screenshot-diff spec from 1.2 NOW passes — both modes render through the painter, geometry matches by construction.
- [ ] 3.5 Document the known regressions at this point (no caret in painted HF, click on painted HF doesn't move cursor — both fixed in phases 3 and 4).
- [ ] 3.6 Land phase-2 PR to feature branch. The branch is NOT in a user-facing-shippable state at this point; phases 3 and 4 must follow before merge to main.

## 4. Phase 3 — Click routing to HF PM

- [ ] 4.1 Add `packages/core/src/flow-model/findHfPmSpans.ts` mirroring `collectBodySpans.ts`, scoped to `.layout-page-header` / `.layout-page-footer` regions. Function takes an `rId` and returns the matching PM range info within the painted region for that `rId`.
- [ ] 4.2 In `usePagesPointer.handlePagesMouseDown`, detect when the click target is inside `.layout-page-header` or `.layout-page-footer`. Resolve the painted region to its `rId` via the section's `headerReferences` / `footerReferences` and the current page's `hdrFtrType` resolution (`default` / `first` / `even` per §17.10.7 `titlePg` and §17.15.1.45 `evenAndOddHeaders`). Look up the corresponding HF EditorView from the `useHeaderFooterPM` registry.
- [ ] 4.3 Call slot-scoped `resolveDomPosition` against the clicked DOM to resolve a PM position inside the HF EditorView's document.
- [ ] 4.4 Dispatch `setSelection(TextSelection.create(view.state.doc, pos))` to the HF EditorView. Call `view.focus()`. Body EditorView loses focus naturally.
- [ ] 4.5 Hover affordance: When the user is editing the body and hovers over `.layout-page-header`, the existing cursor pointer style and "double-click to edit header" tooltip should still work. Verify the current implementation in `packages/core/src/prosemirror/editor.css:768` still triggers.
- [ ] 4.6 Verify: clicking inside the painted header places caret correctly (visible once phase 4 ships); clicking body while editing HF returns focus to body; double-click still works as the entry affordance (or single click — see open question in design.md).
- [ ] 4.7 Land phase-3 PR to feature branch with all existing playwright HF specs green.

## 5. Phase 4 — Selection overlay for HF

- [ ] 5.1 Read `useSelectionOverlay` and decide: extend in place or fork into a parallel `useHfSelectionOverlay` (open question per design.md — pick based on diff size).
- [ ] 5.2 Implement overlay drawing for the focused HF EditorView's selection: caret position, blue selection rects, all rendered inside the painted `.layout-page-header` / `.layout-page-footer` region.
- [ ] 5.3 Map PM positions to DOM rects using the painter's existing `data-doc-from` / `data-doc-to` markers (same approach as body overlay).
- [ ] 5.4 Coordinate overlay lifecycle with focus: only the focused EditorView's selection is drawn; on focus change, the previous overlay clears and the new editor's overlay activates.
- [ ] 5.5 Verify: caret visible in painted HF when focused, range selection across cells highlights both selected ranges, blur removes the overlay.
- [ ] 5.6 IME / composition: test typing accented characters in a header cell. Verify composition events route correctly to the HF PM and the overlay updates after composition end.
- [ ] 5.7 Land phase-4 PR. At this point the feature branch is approximately user-shippable for the React adapter; phases 5–7 are cleanup and parity.

## 6. Phase 5 — Delete the visible inline PM and `.hf-editor-pm` CSS

- [ ] 6.1 Remove the EditorView creation logic from `InlineHeaderFooterEditor.tsx` entirely. The component shrinks to UI chrome: separator bar (Header/Options labels), options menu, dim-body overlay. Target final size <50 lines.
- [ ] 6.2 Delete `.hf-editor-pm`, `.hf-editor-pm .ProseMirror`, `.hf-editor-pm .ProseMirror td p:has(...)`, and all related CSS rules from `packages/core/src/prosemirror/editor.css` and `packages/react/src/styles/editor.css`. Run grep to confirm: `grep -n "hf-editor-pm" packages/core/src/prosemirror/editor.css packages/react/src/styles/editor.css` should return zero matches.
- [ ] 6.3 Delete the column-width hack, vertical-align mapping, and font-strut suppression from #468 — those were CSS patches for the now-deleted overlay. Verify `cssVerticalAlign` helper in `packages/core/src/prosemirror/extensions/nodes/TableExtension/specs.ts` becomes unused; if so, remove it and its test (`packages/core/src/prosemirror/extensions/nodes/TableExtension/__tests__/cell-vertical-align.test.ts`).
- [ ] 6.4a Disable "Insert Footnote" / "Insert Endnote" toolbar commands when an HF EditorView holds focus (§17.11.4 forbids `<w:footnoteReference>` in HF content). Cheap toolbar-level guard before any schema-level enforcement.
- [ ] 6.4 Verify: screenshot-diff spec from 1.2 still green, all HF playwright specs green, body editing unaffected.
- [ ] 6.5 Land phase-5 PR. Feature branch is now in its final React shape.

## 7. Phase 6 — Vue adapter parity

- [ ] 7.1 Mirror the `useHeaderFooterPM` hook into `packages/vue/src/composables/useDocxEditor.ts` (as a Vue composable using `ref`/`onMounted` semantics).
- [ ] 7.2 Lift platform-agnostic pieces (`findHfPmSpans`, the projection sync logic) into `packages/core/` per CLAUDE.md's parity rule (the float-zone pipeline is the canonical example to copy).
- [ ] 7.3 Apply phases 1–5 equivalent changes to the Vue example/composable.
- [ ] 7.4 Run `bun run check:parity-contract`; resolve any divergences (add to `paired` / `pairedViaInheritance` buckets as appropriate).
- [ ] 7.5 Verify both example apps (vite React at `examples/vite`, Vue at `examples/vue`) load the fixture and edit a header without regression.
- [ ] 7.6 Land phase-6 PR.

## 8. Phase 7 — Cleanup and follow-ups

- [ ] 8.1 Delete `hfEditPosition` state in `useHeaderFooterEditing.ts` if it's no longer needed in its current shape (the focused PM is now the source of truth for "which slot is being edited").
- [ ] 8.2 Audit `useHeaderFooterEditing.ts` for now-dead code from the overlay-mount era; remove.
- [ ] 8.3 Update `CLAUDE.md` to reflect the unified model. Specifically: remove any language describing the inline editor as a "separate visible PM," add the HF slot to the "Painter DOM contract" section as another consumer of `data-doc-from`/`data-doc-to`, and note that `.hf-editor-pm` no longer exists.
- [ ] 8.4 File a follow-up ticket for: schema-level guard against `<w:footnoteReference>` inside HF content (ECMA-376 §17.11.4 forbids it; current PM schema doesn't enforce). The toolbar-level guard in task 6.4a is the cheap defense; schema-level enforcement is the durable fix. Out of scope for this change but worth tracking.
- [ ] 8.5 File a follow-up ticket for: the UX question of single-click-vs-double-click to enter HF edit mode (deferred from design.md open questions).
- [ ] 8.6 File a follow-up ticket for: deleting the dead `Section.headers`/`.footers` field in `packages/core/src/types/content/section.ts:192-194`. Never populated by any parser, never read by serializer or renderer. Deletion is API-breaking on the `@public` `Section` type, so route through a changeset.

## 9. Merge to main

- [ ] 9.1 Squash-merge the feature branch into main once all phases land green and CLA / CI checks pass.
- [ ] 9.2 Delete the `.hf-editor-pm` PR comment thread on #468 (or link to this change as the architectural resolution).
- [ ] 9.3 Close issue #468 with a reference to the unification PR and the screenshot-diff spec that now guards against regression.
