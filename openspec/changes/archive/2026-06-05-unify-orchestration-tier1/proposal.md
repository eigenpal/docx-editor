## Why

The React and Vue adapters each re-implement the same editor orchestration. `@docx-editor.dev/core` already owns every underlying algorithm with zero framework imports, but a layer of pure `(view, args) → result` logic still lives twice — in `packages/react/` and `packages/vue/` — and has silently drifted. Issue #696 tracks unifying this. Tier 1 is the subset that can be lifted verbatim: pure logic with ~zero divergence, each lift independently shippable, deleting two copies and (mostly) introducing no public API change. It is a pure win regardless of whether the Tier 2 engine spine ever lands, and it closes three latent Vue parity gaps along the way.

## What Changes

Eight independently-shippable lifts. Each moves pure logic into `packages/core/src/`, leaves framework state machines and reactivity in the adapters, and lands in **both** adapters in the same PR.

- **paraText helpers** — move `findParaIdRange`, `findTextInPmParagraph`, `getVanillaNodeText`, `getVanillaTextBetween` to core (the existing `TODO(file-size-cap)` in `paraTextHelpers.ts`). Foundation for the lifts below.
- **Query helpers** — move `findInDocument` / `getSelectionInfo` / `getPageContent` to core (Vue already has the pure signatures; React's ref-closure copies delegate to them).
- **domSelection dedup + cell highlight** — delete React's private duplicates of core's `getCaretPositionFromDom` / `readSelectionGeometry`; move `applyCellSelectionHighlight` to core and **wire it into Vue** (Vue lacks it today).
- **applyFormatting + setParagraphStyle** — lift the byte-for-byte-identical mark/style body to core with an injected `getStyleResolver`; both adapters delegate.
- **Table-resize read/commit** — move the six pure reader/commit functions and shared twips constants to core; the resize FSMs stay in the adapters.
- **Image PM-commit** — move the float/inline commit fork (`commitImageResize`, `commitImageDragMove`) to core; gesture tracking and hit-testing stay in the adapters.
- **Drag auto-scroll** — lift the scroll-delta math to core and **wire Vue's unused `useDragAutoScroll` into its pointer handler** (currently exported but never called — latent Vue parity gap).
- **Comment / proposeChange transaction builders** — lift the pure PM mark operations (`createCommentTr`, `replyTr`, `proposeChangeTr`) to core. Adopt React's module-counter ID allocation as canonical, fixing Vue's separate-max revision-ID bug. Adapter state/notify wiring stays put.

Out of scope (Tier 2/3): the `DocxEditorEngine` spine, the transaction→repaint loop, scroll orchestration, save-path unification, and the `onContentChange`/`onSelectionChange` subscription hub.

## Capabilities

### New Capabilities

- `core-paratext`: Framework-agnostic ProseMirror paragraph/text helpers (`findParaIdRange`, `findTextInPmParagraph`, `getVanillaNodeText`, `getVanillaTextBetween`) shared by both adapters.
- `core-doc-queries`: Pure document query functions (`findInDocument`, `getSelectionInfo`, `getPageContent`) taking `view`/`layout` as explicit parameters.
- `core-cell-selection-highlight`: `applyCellSelectionHighlight` moved to core and made available to both adapters (closes Vue gap).
- `core-apply-formatting`: `applyFormatting` / `setParagraphStyle` as pure functions over an `EditorView` with an injected style resolver.
- `core-table-resize-ops`: Pure table-resize readers and commit transaction builders (column / row / right-edge) plus shared twips constants.
- `core-image-commit`: Pure image resize / drag-move commit functions covering the float vs inline fork.
- `core-auto-scroll-math`: Shared drag auto-scroll delta computation, with Vue's pointer handler newly wired to use it.
- `core-comment-ops`: Pure comment / reply / proposeChange transaction builders with canonical (module-counter) ID allocation.

### Modified Capabilities

## Impact

- **`@docx-editor.dev/core`**: gains eight new pure modules + matching `package.json` `exports` keys (explicit, no wildcards).
- **`@docx-editor.dev/react`**: duplicated helpers/internals become thin re-exports or delegations; no public ref/prop API change in signature. `applyFormatting`/`setParagraphStyle`/comment methods re-verified via `api:extract` + parity contract.
- **`@docx-editor.dev/vue`**: same lifts; **gains** cell-selection highlight, drag auto-scroll, and a comment/revision ID fix (no more separate-max collisions after deletes).
- **Parity contract**: ref methods already sit in `pairedViaInheritance`; this tightens the actual implementations behind that contract. CI gate `bun run check:parity-contract` runs on the PRs touching public surface.
- **Vanilla JS package (#89)**: unblocked incrementally — every lifted function is one less thing the future thin wrapper must re-implement.
- **Risk**: low for PRs 1–3 and 7 (pure helpers + Vue wiring), medium for 4–6 and 8 (touch formatting, tables, images, tracked-change ID space). Each PR is gated by targeted Playwright specs in both adapters.
