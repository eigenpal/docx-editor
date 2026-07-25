# Interactive paginated editing — accelerated execution tasks

Progress: **75 / 120** complete.

| Baseline | Count |
| --- | --- |
| M0 historical (tasks 1–4) | **28** |
| Pre-**5.5** current (adds 5.1–5.4) | **32** |
| Post-**5.5** (commit **`checkpoint-a7763cfb`**, 33rd task) | **33** |
| **M0-R1** (baseline verification) | **34** |
| **M0-R2** (authority review) | **35** |

Milestones **M0–M6** define the accelerated delivery order; sections **7–10** retain
the full deferred scope. The first formal public **`interactive-paginated`** claim
is task **8.10** (after async layout, virtualization, and performance gates). **M6**
records paired bounded-document **internal/preview alpha** only.

Each counted checkbox through **M6-R2** ends with exactly **one normal commit** after
review. Unrelated dirty files in the workspace MUST remain unstaged. There are no
milestone summary commits and no git tags. Every checkbox stages an evidence or
deliverable artifact listed in its staging manifest row.

Evidence artifacts live under `openspec/changes/interactive-paginated-editing/evidence/m0/` through `openspec/changes/interactive-paginated-editing/evidence/m6/` with exact filenames declared in each task and staging manifest row.

---

## Milestone map

| Milestone | Scope | Claim allowed after pass |
| --- | --- | --- |
| **M0** | Baseline contracts + hidden input-host evidence (tasks 1–4) | Hidden input-host mechanism only (already approved) |
| **M1** | Finish 5.5 + body-paragraph 5.6a + sync stale 5.7a | None |
| **M2** | Shared style / paint / event bridge + deterministic click targets | None |
| **M3** | React one-surface no-chrome proof (real painted-page interaction) | Internal React one-surface alpha only |
| **M4** | Polished retired shell + `Editor.can`/`Editor.exec` toolbar + display-only rulers | Internal React alpha with shell |
| **M5** | Vue equivalent shell + interaction parity | None (pre-paired preview) |
| **M6** | Paired bounded-document internal/preview alpha + default demo switch | **Internal/preview alpha only** — not public `interactive-paginated` |
| **M6D** | React root loads the comprehensive DOCX fixture by default | Demo fixture only; no feature-support claim |
| **M6P** | Per-block partial editability for mixed complex DOCX bodies | Safe paragraph editing only; unsupported regions remain immutable |
| **M6K** | Restore ProseMirror-native editing and logical keyboard semantics on React | Interaction correctness only; paginated geometry authority remains unchanged |
| **M6V** | Full retired-chrome visual parity on React only | Visual parity only; no wider editing or conformance claim |
| **M6S** | Browser-native selection-presentation bake-off | Rendering optimization only; semantic ownership remains unchanged |
| **10V** | Final mechanical Vue port after the React implementation is otherwise complete | Restores final adapter parity without reopening design |
| **7–10** | Full roles, async, virtualization, collab, feature lanes, final gates | Public `interactive-paginated` at **8.10** only |

---

## M0 — Baseline evidence (implementation complete; verification pending)

### 1. Authority, status, and conformance vocabulary

- [x] 1.1 Replace every landed "WYSIWYG" checkpoint that currently proves only model-to-preview repaint with "paginated preview repaint", and link direct editing completion to this change.
- [x] 1.2 Add the rendered, interactive-read-only, fallback-editable, typed-editable, interactive-paginated, and feature-WYSIWYG states to the shared feature-support manifest without changing unrelated feature claims.
- [x] 1.3 Cross-reference this change from the binding, layout, partial-editability, paired-adapter, package-topology, and comprehensive coverage tasks that supply prerequisites; retain their independent completion gates.
- [x] 1.4 Add an authority/import test proving adapters cannot import ProseMirror, implement document geometry, or bypass the public `Editor`/`EditorHost` facade.
- [x] 1.5 Freeze the supported browser/platform matrix for pointer, keyboard, clipboard, IME, accessibility, and mobile/virtual-keyboard evidence before implementation claims begin.

### 2. Interaction contracts and immutable frames

- [x] 2.1 Add PM-free contracts for interaction-frame identity, model/layout revisions, semantic hit targets, caret geometry, selection geometry, focus/composition state, and typed stale/pending/read-only/invalid outcomes.
- [x] 2.2 Extend the public editor facade so display, page geometry, selection, caret, and hit-test results can be consumed from one provably coherent interaction frame.
- [x] 2.3 Implement immutable interaction-frame construction in `engine-editor`, including selection-only frames that safely reuse an unchanged layout revision.
- [x] 2.4 Publish frame replacement atomically and retain the last complete frame while newer derived work is pending.
- [x] 2.5 Add adversarial tests that interleave selection changes, model commits, resource/configuration epoch changes, cancelled layout, and adapter reads and prove no mixed-revision geometry is observable.
- [x] 2.6 Define engine-neutral `EditorDriver` operations and observations for client-coordinate pointer input, semantic selection, current page, frame identity, caret/range geometry, focus, composition, and typed rejected interaction.

### 3. Semantic positions, clusters, and geometry

- [x] 3.1 Freeze geometry fixtures for empty/trailing paragraphs, tabs, whitespace, combining characters, surrogate pairs, ligatures, RTL/bidi runs, vertical movement, page boundaries, transformed items, table cells, atomic images, and read-only content.
- [x] 3.2 Replace provisional display-item accumulated offsets with model-derived story/scope, stable semantic identity, grapheme offset or atomic target, and affinity indexes.
- [x] 3.3 Emit shaped-cluster-to-semantic-position maps that preserve grapheme boundaries, bidi affinity, logical order, and deterministic tie breaking.
- [x] 3.4 Emit explicit caret stops and ownership regions for empty paragraphs, trailing positions, line areas, structural boundaries, and capability-owned whitespace.
- [x] 3.5 Implement client-to-content coordinate conversion through scroll, zoom, page offsets, clipping, writing mode, and invertible item transforms.
- [x] 3.6 Implement reverse-z-order hit testing with pointer-transparent decoration, clipping, hit ownership, interaction roles, and fail-closed non-invertible transforms.
- [x] 3.7 Implement engine-derived collapsed caret rectangles with page, clipping, writing direction, transform, and affinity data.
- [x] 3.8 Implement engine-derived visible rectangles for text and currently supported node/table-cell/control/story/annotation selections while retaining complete semantic ranges offscreen.
- [x] 3.9 Add deterministic and property tests for semantic-position round trips, coordinate-transform round trips, cluster edge ties, empty content, overlap/z-order, clipping, and malformed geometry.

### 4. Hidden input-host falsification gate

- [x] 4.1 Mount the ProseMirror input host attached and non-`display:none`, keep it outside visible layout authority, and prevent duplicate visible or assistive document content.
- [x] 4.2 Synchronize engine semantic selection to ProseMirror before focus/native input and preserve the engine selection across blur, owned popups, projection reconciliation, and remote changes.
- [x] 4.3 Prototype the selected clipped/repositioned input-host technique near the engine caret and record how browser IME/input UI follows the active caret on the supported platform matrix.
- [x] 4.4 Add composition tests for start/update/end/cancel, repeated updates, blur, dead keys, surrogate pairs, combining clusters, RTL input, remote invalidation, and capability-boundary rejection with no duplicate or lost text.
- [x] 4.5 Add clipboard, beforeinput, drag/drop, keyboard-command, mobile/virtual-keyboard, and focus-transfer tests proving events use existing bounded parsing and store-first validation.
- [x] 4.6 Implement the minimum single semantic/accessibility projection required for the body-paragraph gate, including reading order, editability, focus, and selection mapped to canonical identities.
- [x] 4.7 Add accessibility-tree tests proving the hidden ProseMirror projection and engine semantic projection do not expose duplicate documents or contradictory focus/editability.
- [x] 4.8 Run the browser/platform gate through public adapter builds and either approve the hidden-host mechanism with recorded evidence or stop and revise it before page-interaction work continues.

### M0 review and evidence

- [x] M0-R1 Write `openspec/changes/interactive-paginated-editing/evidence/m0/baseline-verification.md` recording: M0 historical **28** (tasks 1–4); pre-**5.5** **32** (adds 5.1–5.4); **5.5** completed as 33rd task in commit **`checkpoint-a7763cfb`** (not in progress); cross-check against `openspec/changes/interactive-paginated-editing/input-host-prototype-evidence.md` and `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md` for consistency only. Stage and commit per staging manifest.
- [x] M0-R2 Write `openspec/changes/interactive-paginated-editing/evidence/m0/authority-review.md` recording: authority/import test id **1.4** still green; no forbidden retired authority imports in production adapters; task **5.5** completed as 33rd task in commit **`checkpoint-a7763cfb`** (M0-R2 checkbox text originally assumed **5.5** remained unchecked). Stage and commit per staging manifest.

---

## M1 — Finish 5.5 + body-paragraph 5.6a + sync stale 5.7a

Prerequisite for all adapter page wiring (M2+). Do not start M2 until M1-R2
passes.

### 5. Shared pointer and keyboard interaction controller

- [x] 5.1 Implement a framework-neutral interaction controller that accepts host metrics and native event intent and returns ProseMirror selection/command requests through `EditorBinding`, focus, capture, scroll, or typed rejection effects without owning parallel selection state.
- [x] 5.2 Implement single-click caret placement and shift-click extension through frame-bound hit targets and `EditorBinding`.
- [x] 5.3 Implement Unicode-aware double-click word and capability-owned triple-click block selection without splitting grapheme clusters.
- [x] 5.4 Implement pointer-drag selection with capture across lines and pages, preserving semantic anchors when layout frames change.
- [x] 5.5 Implement logical horizontal navigation and engine-geometry vertical, Home/End, and page navigation with retained visual advance and bidi/affinity tests. **Deliverable:** `packages/engine-editor/src/keyboard-navigation.ts`, `packages/engine-editor/src/navigation-session.ts`, `packages/engine-editor/src/navigation-stops.ts`, `packages/engine-editor/src/navigation-geometry.ts`, `packages/engine-editor/src/line-catalog.ts`, `packages/engine-editor/test/keyboard-navigation.test.ts`, `packages/engine-editor/test/navigation-session.test.ts`, `packages/engine-editor/test/navigation-production.test.ts`, `packages/engine-editor/test/line-catalog.test.ts` green.
- [x] 5.6a Implement body-paragraph safety subset for editable text, read-only/selectable text within the supported matrix, page background, margins, and inter-page gaps only. **Deliverable:** interaction planner resolves body-paragraph roles with typed rejection outside the subset; unit tests cover margin/gap/background and editable vs read-only body text.
- [x] 5.7a Resolve frame-bound pointer targets synchronously against current canonical state for the body-paragraph subset and return typed stale/invalid outcomes rather than stale numeric-offset mutations. **Deliverable:** synchronous stale-frame tests in `engine-editor` prove fail-closed behavior before adapter wiring.
- [ ] 5.6 Implement declared behavior for atomic objects, controls, annotations, and remaining interaction roles beyond the body-paragraph subset. **Deliverable:** full role matrix tests; **deferred until after M6** unless a feature lane explicitly reopens it.
- [ ] 5.7 Resolve frame-bound pointer targets through edit-surviving anchors against current canonical state under asynchronous repagination for the full role matrix. **Deliverable:** async anchor rebase tests; **deferred until section 7 lands**.
- [ ] 5.8 Add collaboration tests for local pointer/keyboard interaction interleaved with remote insert, delete, split, move, repagination, and selection-anchor invalidation. **Deliverable:** collab interaction suite; **deferred until sync prerequisite and section 7.4/7.7 land**.

### M1 review and evidence

- [x] M1-R1 Run: `bun test packages/engine-editor/test/keyboard-navigation.test.ts packages/engine-editor/test/navigation-session.test.ts packages/engine-editor/test/navigation-production.test.ts packages/engine-editor/test/line-catalog.test.ts packages/engine-editor/test/interaction-planner.test.ts packages/engine-core/test/adapter-authority.test.ts`; `bun run typecheck`; `openspec validate interactive-paginated-editing --strict`; `git diff --check`. Write pass/fail counts to `openspec/changes/interactive-paginated-editing/evidence/m1/verification-log.md`. Stage and commit per staging manifest. **Expected:** all listed tests pass; strict validation pass.
- [x] M1-R2 Write `openspec/changes/interactive-paginated-editing/evidence/m1/summary.md`; mark **5.5**, **5.6a**, **5.7a** complete; stage and commit per staging manifest; leave **5.6**, **5.7**, **5.8** unchecked.

---

## M2 — Shared style, paint, event bridge, deterministic targets

Prerequisite for M3. Adapters still render no product chrome.

- [x] 6.1 Add the shared page, semantic/accessibility, selection/caret/composition overlay, and input-host CSS/paint primitives to the single-source core stylesheet. **Deliverable:** `packages/core/src/styles/editor.css` exposes one-surface layer classes/tokens consumed by both adapters.
- [x] M2.1 Implement a shared adapter event bridge module that forwards pointer, keyboard, focus, scroll, and capture events from host DOM to the interaction controller through public contracts only. **Deliverable:** framework-neutral bridge consumed identically by React/Vue hosts.
- [x] M2.2 Wire overlay paint helpers so caret/selection rectangles render from interaction-frame geometry with clipping, transforms, writing direction, zoom, and pointer transparency. **Deliverable:** shared paint utilities (extend `packages/react/src/paintDisplay.tsx` pattern).
- [x] M2.3 Emit stable public test attributes and/or driver-readable client rectangles on the bounded-document fixture's first editable body-paragraph glyph (e.g. `data-testid="one-surface-click-target"` on the target display item or equivalent public query). **Deliverable:** Playwright and manual gates locate the target by attribute/query center click — never hardcoded page coordinates or whitespace.
- [x] M2-R1 Run: `bun test packages/engine-editor/test/display-bridge.test.ts`; `bun run check:adapter-css-thin`; `bun run typecheck`; `openspec validate interactive-paginated-editing --strict`; `git diff --check`. Write pass/fail counts to `openspec/changes/interactive-paginated-editing/evidence/m2/verification-log.md`. Stage and commit per staging manifest.
- [x] M2-R2 Write `openspec/changes/interactive-paginated-editing/evidence/m2/summary.md`; stage and commit per staging manifest.

---

## M3 — React one-surface no-chrome proof

Real painted-page pointer interaction is mandatory. `authorizeCaret`-only proof is
insufficient.

- [x] 6.2 Wire React host coordinates, focus, pointer capture, keyboard/native input, scroll, zoom, and frame lifecycle to the shared controller using only public contracts. **Deliverable:** `packages/react/src/DocxEditor.tsx` routes real pointer events on painted output to the interaction controller.
- [x] 6.4 Render caret and selection overlays from interaction-frame geometry with correct clipping, transforms, writing direction, zoom, pointer transparency, and explicit handle/control exceptions. **Deliverable:** visible caret/selection on painted pages in React harness.
- [x] M3.1 Create `e2e/react-one-surface.interaction.spec.ts`, `e2e/oneSurfaceHelpers.ts`, and `package.json` script `test:e2e:react-one-surface-interaction` (`playwright test --config e2e/editor-smoke.config.ts e2e/react-one-surface.interaction.spec.ts`) before first use. Scenarios: locate M2.3 click target → real pointer click center → type/backspace → shift-click → double-click → drag selection → keyboard nav → clipboard paste → synthetic composition → undo/redo → save/reopen. **Deliverable:** spec green via `bun run test:e2e:react-one-surface-interaction`; no `authorizeCaret` primary proof.
- [x] M3.2 Record manual Chrome DevTools pass in `openspec/changes/interactive-paginated-editing/evidence/m3/manual-chrome-checklist.md`: start `bun run dev:react -- --port 5273 --strictPort --force`; open `http://127.0.0.1:5273/?realAdapter=1`; follow runbook §5 M3.2 steps. Stage and commit per staging manifest.
- [x] M3-R1 Run: `bun run verify:real-adapter-smoke`; `bun run verify:real-adapter-gate`; `bun run test:e2e:react-one-surface-interaction`; `bun run typecheck`; `openspec validate interactive-paginated-editing --strict`; `git diff --cached --check`; `git diff --check`. Write results to `openspec/changes/interactive-paginated-editing/evidence/m3/verification-log.md`. Stage and commit per staging manifest. **Expected:** smoke 2/2, gate 12/12, one-surface spec all pass.
- [x] M3-R2 Write `openspec/changes/interactive-paginated-editing/evidence/m3/summary.md`; update `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md`; stage and commit per staging manifest; allowed claim: **internal React one-surface alpha only**.

---

## M4 — Port polished retired shell presentation (React)

Presentation reference: the recorded presentation baseline. Port presentation and
user-visible shell behavior component-by-component via `git show`; never wholesale
checkout/revert forbidden authority modules.

- [x] M4.0 Ensure PM-free toolbar prerequisites: `Editor.can(command)` before `Editor.exec(command)` for **bold**, **italic**, **underline**, **undo**, and **redo**; save button calls **`Editor.save()`** directly; run `bun run api:extract` + `bun run api:check`. Document title ownership stays in shell/example local state. **Deliverable:** typed command wiring + API snapshot.
- [x] M4.1 Write shell port inventory and demo-boundary record in `openspec/changes/interactive-paginated-editing/evidence/m4/inventory.md` (retired file → port decision → greenfield contract; museum Apps vs preview default). **Deliverable:** signed port/replace matrix per `design.md` D14.
- [x] M4.2 Port core shell layout and page backdrop/shadow presentation from `DocxEditorShell.tsx` onto the greenfield React host. **Deliverable:** scroll host, backdrop, content scoping match retired presentation; no `PagedEditor` or retired hooks.
- [x] M4.3 Port document title chrome and page indicator. **Deliverable:** title in local shell state; `PageIndicator` from public editor page queries.
- [x] M4.4 Port horizontal and vertical rulers as **display-only** components using **`Editor.getPageGeometry()`** only; omit or disable margin/tab markers and drag controls (no section-geometry contract in this change). **Deliverable:** rulers align to painted page geometry; no margin/tab mutation paths.
- [x] M4.5 Port toolbar presentation; formatting/history actions check `Editor.can(command)` then call `Editor.exec(command)`; save button calls `Editor.save()` directly; unsupported controls disabled or hidden; no direct ProseMirror or retired hooks. **Deliverable:** bold/italic/underline/undo/redo via can/exec; save via `Editor.save()`.
- [x] M4.6 Port dialogs/sidebar incrementally (supported toggles only); unsupported dialogs disabled/hidden. **Deliverable:** public editor contracts only.
- [x] M4.7 Label old default demo Apps (`?edit=1`, retired museum paths) reference-only; document preview default switch boundary in `openspec/changes/interactive-paginated-editing/evidence/m4/demo-boundary.md`. **Deliverable:** no public claim upgrade.
- [x] M4-R1 Run: `bun run test:e2e:react-one-surface-interaction`. Write results to `openspec/changes/interactive-paginated-editing/evidence/m4/verification-log.md`. Stage and commit per staging manifest. **Expected:** all scenarios pass.
- [x] M4-R2 Manual Chrome shell checklist in `openspec/changes/interactive-paginated-editing/evidence/m4/manual-chrome-shell.md`: toolbar disabled/enabled matches `Editor.can({ type: 'toggleMark', mark: 'bold' })`; click invokes `Editor.exec({ type: 'toggleMark', mark: 'bold' })`; save uses `Editor.save()`; display-only rulers; backdrop/shadows; M3.2 click/type still passes. Stage and commit per staging manifest.
- [ ] M4-R3 Independent review (no open Blocker/High); write `openspec/changes/interactive-paginated-editing/evidence/m4/summary.md`; stage and commit per staging manifest; claim remains **internal React alpha with shell**.

---

## M5 — Vue equivalent shell and interaction parity

- [x] 6.3 Implement the equivalent Vue composition; adapter CSS import-only and behaviorally paired. **Deliverable:** Vue host matches React one-surface event/overlay wiring.
- [x] M5.1 Port polished shell presentation to Vue with the same inventory matrix as M4. **Deliverable:** paired visual shell on Vue harness; same can/exec and display-only ruler rules.
- [x] M5.2 Create `e2e/vue-one-surface.interaction.spec.ts` and `package.json` script `test:e2e:vue-one-surface-interaction` before first use; mirror M3.1 target-location pattern. **Deliverable:** spec green via `bun run test:e2e:vue-one-surface-interaction`.
- [x] M5-R1 Run: `bun run verify:real-adapter-smoke`; `bun run verify:real-adapter-gate`; `bun run test:e2e:vue-one-surface-interaction`; `bun run check:parity-contract`; `bun run typecheck`; `openspec validate interactive-paginated-editing --strict`; `git diff --cached --check`; `git diff --check`. Write results to `openspec/changes/interactive-paginated-editing/evidence/m5/verification-log.md`. Stage and commit per staging manifest.
- [x] M5-R2 Write `openspec/changes/interactive-paginated-editing/evidence/m5/summary.md`; stage and commit per staging manifest; no public claim upgrade.

---

## M6 — Paired bounded-document internal/preview alpha

Not the formal public **`interactive-paginated`** claim (that remains **8.10**).

- [x] 6.5 Create `e2e/paired-one-surface.interaction.spec.ts` and `package.json` script `test:e2e:paired-one-surface-interaction` covering React + Vue bounded-document fixture through the one-surface path (click target → type → selection → `Editor.can({ type: 'toggleMark', mark: 'bold' })` then `Editor.exec({ type: 'toggleMark', mark: 'bold' })` → clipboard → synthetic composition → undo/redo → **`Editor.save()`** reopen). **Deliverable:** paired spec green; supersedes separate React/Vue rows in CI when wired.
- [x] 6.6 Make split edit/preview explicitly diagnostic; remove from normal demo startup after paired preview baseline passes. **Deliverable:** default preview demo uses greenfield one-surface + shell; `?edit=1` diagnostic only.
- [x] M6.1 Update `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md` and internal preview notes for **paired bounded-document internal/preview alpha**; feature-support manifest and public docs MUST remain below `interactive-paginated`. **Deliverable:** honesty rules explicit that **8.10** is first public claim.
- [x] M6-R1 Run: `bun run verify:real-adapter-smoke`; `bun run verify:real-adapter-gate`; `bun run verify:a11y-tree`; `bun run test:e2e:paired-one-surface-interaction`; `bun run check:parity-contract`; `bun run typecheck`; `openspec validate interactive-paginated-editing --strict`; `git diff --cached --check`; `git diff --check`. Write results to `openspec/changes/interactive-paginated-editing/evidence/m6/verification-log.md`. Stage and commit per staging manifest.
- [ ] M6-R2 Manual paired preview checklist in `openspec/changes/interactive-paginated-editing/evidence/m6/manual-chrome-paired.md` (Vue `http://127.0.0.1:5274/?realAdapter=1` and React `http://127.0.0.1:5273/?realAdapter=1`); independent review (no Blocker/High); write `openspec/changes/interactive-paginated-editing/evidence/m6/summary.md`; mark **6.5** and **6.6** complete; stage and commit per staging manifest. **Allowed:** internal/preview alpha — **not** public `interactive-paginated`.

---

## M6D — Default comprehensive React document

- [x] M6D.1 **Immediate React entrypoint task; fixture wiring only.** Make the bare React demo URL `/` load the canonical `e2e/fixtures/comprehensive-word-element-test.docx` through the production `packages/react/src/DocxEditor.tsx` surface by default. Keep one canonical fixture byte source: use a build/dev asset mapping or an automated byte-identical copy rather than maintaining a manually divergent second DOCX. Preserve the sanitized `?fixture=<basename>.docx` override so focused tests can still select smaller fixtures, and show a bounded localized loading/error state if the default fixture cannot be fetched or parsed. Do not require `?realAdapter=1`, `?edit=1`, or consumer-side shell assembly. **Pass boundary:** opening `http://127.0.0.1:5273/` in Chrome loads all nine pages of the comprehensive fixture without user action; expected representative text is visible; the title/menu/toolbar/rulers/workspace remain mounted; loaded bytes are proven identical to the canonical fixture; and `?fixture=editable-sample.docx` still works. Record URL, page count, byte-identity evidence, screenshots, unsupported structures observed, and Chrome results in `openspec/changes/interactive-paginated-editing/evidence/m6/default-comprehensive-fixture.md`. This task does not claim editability; mixed-document editing is owned by M6P.1.

---

## M6P — Per-block partial editability

- [x] M6P.1 **Implement the already-approved `partial-body-editability` contract before the final React goal gate.** Replace the document-wide editable boolean with an immutable, revision-bound body access policy containing `mode: 'full' | 'partial' | 'none'`, patchable block identities, read-only-region diagnostics, and structural-mutation allowance. A preserved, losslessly patchable top-level paragraph MUST remain editable when neighboring body blocks are tables, SDTs, unsupported structures, or paragraphs with unowned inline content. Every unsupported or unsafe block MUST remain visible through the engine-painted document and MUST project into the binding as an identity-bound immutable boundary. Reverse mapping MUST authorize editable paragraph identities and validate read-only identities against the current canonical policy; it MUST reject deletion, replacement, movement, duplication, cross-boundary selection/editing, multi-block paste, and unsupported split/join/structural transactions before `DocumentStore.apply`. In partial mode, accepted edits MUST be limited to capability-owned operations within one patchable block and save MUST selectively regenerate only the changed owned range while preserving every untouched read-only XML range, relationship, media payload, and unrelated package part according to the preservation contract. A preserve/staging list protects concurrent unrelated hunks; it MUST NOT be treated as an architectural reason to retain document-wide read-only behavior. Re-read and merge current work before touching a protected file, stage only task-owned hunks, and never overwrite unrelated modifications.

  **Comprehensive-fixture pass boundary:** the bare React `/` opens `comprehensive-word-element-test.docx` in `partial` mode; at least one proven-safe body paragraph can be clicked, typed into, selected, bolded/italicized, undone/redone, saved, and reopened with the edit retained. Tables, SDTs, unsupported paragraphs, and other unowned structures remain visible and immutable; clicking them produces a structured read-only result; selection or editing across their boundaries refuses atomically; no unsupported active content executes or fetches externally. Export/reopen MUST prove untouched table/SDT source ranges and unrelated package parts remain byte-identical where exact preservation is declared. Add focused core classification, binding projection/reconciliation, command-policy, selective-save, and real-browser React tests, including a mixed paragraph/table/paragraph fixture and the comprehensive fixture. Record policy diagnostics, changed-range evidence, byte-comparison results, and Chrome steps in `openspec/changes/interactive-paginated-editing/evidence/m6/partial-body-editability-react.md`. This enables safe neighboring paragraph edits only; it MUST NOT claim table, SDT, image, field, or other unsupported feature editing.

---

## M6K — ProseMirror-native keyboard and text-selection behavior

- [x] M6K.1 **React-first interaction correction; complete before M6S.1 and the final React gate.** Stop reimplementing semantic editing commands in the one-surface bridge. ProseMirror MUST own command execution for Backspace/Delete, word and soft/hard-line deletion, Enter, Select All, undo/redo, formatting shortcuts, logical Left/Right, and their Shift/Cmd/Ctrl/Alt/Option variants. The bridge/input policy MUST admit the corresponding safe native `beforeinput` intents, including `deleteWordBackward`, `deleteWordForward`, `deleteSoftLineBackward`, `deleteSoftLineForward`, `deleteHardLineBackward`, and `deleteHardLineForward`, instead of reducing them to basic character deletion or rejecting them. The engine MUST continue to own Up/Down, Home/End, PageUp/PageDown, painted-page and unsupported-structure boundaries, stale-frame validation, read-only/capability preflight, and all hit-test/layout geometry. Engine capture-phase preflight MUST run before any ProseMirror handler for engine-owned keys; a refused command MUST leave both the ProseMirror selection and painted caret unchanged. After ProseMirror handles a command or changes its selection, `EditorBinding` MUST publish the resulting semantic selection into the current interaction frame before the next visible overlay is accepted. `Editor.exec({ type: 'setSelection' })` MUST pass through the same current-frame and semantic-range validator, refusing stale frame IDs and invalid offsets rather than clamping or replacing caller provenance. No adapter may read DOM selection as canonical state.

  **Differential pass boundary:** add a real-browser React gate that drives the production `packages/react/src/DocxEditor.tsx` surface and a raw ProseMirror reference initialized from the same body-paragraph document. Compare resulting document content, paragraph structure, marks, history state, and semantic selection after Cmd/Ctrl+A; Cmd/Ctrl+Backspace/Delete; Alt/Option+Backspace/Delete; logical Left/Right with Shift/Cmd/Ctrl/Alt/Option combinations; Enter; undo/redo; deletion of non-collapsed selections; and paragraph joins/splits. Platform-inapplicable shortcuts MUST be recorded, not silently treated as passes. Add explicit regressions proving an engine-refused Up/Down/Home/End/PageUp/PageDown or boundary crossing cannot be pre-empted by ProseMirror, and proving composition, clipboard, accessibility ownership, read-only policy, stale-frame refusal, grapheme integrity, and hidden-host focus remain green. Record the command matrix, browser/OS results, intentional differences, and Chrome evidence in `openspec/changes/interactive-paginated-editing/evidence/m6/prosemirror-command-parity.md`. This is an interaction-correctness gate, not polish, and MUST NOT widen feature-support claims.

  **Accepted deviation — Shift+Enter.** This task originally required ProseMirror to own
  Shift+Enter. It cannot: the composed schema registers no hard-break node and the model
  has no `w:br` run, so delegating `insertLineBreak` let the browser insert a break that
  ProseMirror then dropped — the key did nothing and the revision never moved. A silent
  no-op is worse than a refusal, so the input policy now refuses `insertLineBreak`. The
  requirement is narrowed to Enter above, and the missing capability is owned by
  **M6K.2** below rather than left implied.

- [ ] M6K.2 **Line break (`w:br`) round-trip.** Add a hard-break run to the model, its
  capability parse/serialize, a projector and schema node in `engine-binding`, and the
  reverse mapping in `mapDocToOps`, then return `insertLineBreak` to the delegated set in
  `edit-surface.ts`. Until this lands, Shift+Enter is refused rather than silently
  dropped (see the accepted deviation in M6K.1). Pass boundary: a Shift+Enter in the
  production surface advances the revision, survives save and reopen as `w:br`, and the
  parity gate asserts it is no longer refused.

- [x] M6P.2 **Stop delegated deletes from silently dropping a preserved `w:rPr`.** Found by
  independent security review of M6K.1; a lossless-preservation violation, not a
  vulnerability. `rawRunProps` had no `parseDOM` (deliberately, for paste safety), and
  delegation is the only input path where ProseMirror's DOM observer RE-PARSES the DOM.
  A word/line delete crossing a run boundary marked the capsule's mark view `NODE_DIRTY`,
  `MarkViewDesc.parseRule()` returned null, and the mark was dropped — the run's authored
  `w:rPr` was gone, `commitFromDoc` did not reject (a capsule run is projectable), and the
  formatting was lost on save. Proven: a run carrying
  `<w:color w:val="FF0000"/><w:sz w:val="48"/>` re-emitted as bare `<w:r><w:t>`.

  Two guards were considered and rejected — recorded so they are not re-attempted:
  rejecting when a model capsule's text no longer appears misses the proven case (the
  capsule run is edited within itself), and rejecting when capsule count drops breaks the
  legitimate removal path, where bold/italic `excludes: 'rawRunProps'` and intentionally
  materializes the mark.

  **Resolved** by an opaque capsule-ref registry: `toDOM` emits
  `data-raw-rpr-ref="<id>"`, and `parseDOM` resolves the id through a map populated only
  by the model projection, dropping unknown refs. The security invariant is unchanged and
  strengthened in statement — capsule BYTES never travel through the DOM, so forging a ref
  can at most re-apply a capsule already in this document, and `input-policy.ts` still
  refuses pasted HTML matching `data-raw-rpr` before it gets that far. Guarded by a
  serialize/parse round-trip test and a rewritten security test; both fail when the
  `parseDOM` rule is removed.

- [ ] M6V.3 **Finish the radix/Tailwind control port.** M6V.2's first slice landed: the
  React dropdown is a radix `Select.Root`/`Trigger` styled with Tailwind utilities over
  the shared token palette, and it carries its localized unavailable reason on the
  control itself. No build work was required — Tailwind already scans the adapter
  sources. **The toolbar controls are now fully converted**: dropdown
  (radix `Select`), stepper, colour-split, chevron, and every icon button use Tailwind
  utilities over the shared token palette, with no hand-rolled CSS left on the React
  side. The `modePill` shape is declared by no descriptor entry and renders nothing —
  either give it a descriptor or drop the shape.

  **Owner decision: one styling system, not two.** The
  fourteen hand-rolled rules (`.ep-toolbar__stepper*`, `.ep-toolbar__color*`,
  `.ep-toolbar__picker*`, `.ep-toolbar__button*`) are DELETED from the core stylesheet rather than kept alive for
  Vue. `packages/vue/src/DocxEditorToolbar.ts:64,72` still emits those class names, so the
  Vue toolbar controls are knowingly unstyled until 10V.1 migrates them to the same
  Tailwind/radix treatment — the owner chose that over carrying a bespoke stylesheet
  beside Tailwind. Vue's behavioral gate (`test:e2e:vue-one-surface-interaction`, 11
  passed) is unaffected because it asserts behavior, not styling. **10V.1 MUST convert
  the Vue toolbar, not restore the CSS.**

- [ ] M6V.6 **Expose page margins so the rulers can render their margin zones.** Measured
  blocker, not a styling gap: `Editor.getPageGeometry()` returns
  `readonly { index: number; box: Rect }[]` and nothing else, while the retired
  `ui/HorizontalRuler.tsx` draws its grey margin zones from left/right margin pixels
  (`MARGIN_ZONE_COLOR = var(--doc-shadow-subtle)`, a 1px inner border, `ew-resize` when
  editable). With only a page box there is nothing to derive them from, and guessing a
  margin would put a wrong ruler over a correct page.

  **The value already exists — this is plumbing, not derivation.** `layoutBody`
  (`packages/engine-layout/src/layout.ts:96`) takes a uniform `margin` from
  `LayoutOptions` and computes `contentRight = pageWidth - margin` /
  `contentBottom = pageHeight - margin` from it. So a real content box can be published
  today; nothing needs inventing. Note the engine's margin is currently UNIFORM on all
  four sides, while Word carries four independent values — publish what the engine
  actually laid out, and do not present it as per-side fidelity it does not have.

  Follow the `Editor.isActive` precedent the owner set: extend the public shape (add
  `contentBox: Rect` to `DisplayPage` and surface it through `getPageGeometry`), return
  the real values above, and wire both rulers to read it.

  **Exact chain, traced — five edits, no unknowns:**
  1. `packages/engine-layout/src/layout.ts:57` — `PageBuilder` takes only `(width,
     height)`; add `margin` and emit `contentBox` in `break()` (line 73), where the page
     object `{ index, width, height, items }` is created.
  2. `layoutBody` (line 96) already destructures `margin` from `LayoutOptions` — pass it
     to the `PageBuilder` constructor at line 99.
  3. The internal `Page` type gains `contentBox`.
  4. `packages/core/src/geometry.ts:153` — add `contentBox: Rect` to `DisplayPage`, and
     carry it through the `Page` → `DisplayPage` conversion in `toDisplayPages`.
  5. `getPageGeometry` currently returns `{ index, box }`; include `contentBox`, then
     `HorizontalRuler`/`VerticalRuler` draw the zones from it (retired uses
     `MARGIN_ZONE_COLOR = var(--doc-shadow-subtle)` with a 1px inner border). Correct wiring first; the ruler lights up when
  the values are real. Do NOT hardcode a default margin to make it look right.

  Note this change owns no section-geometry contract (M4.4 made the rulers deliberately
  display-only), so the zones stay non-interactive: no drag handles, no margin mutation.
  Retired's `ew-resize` cursor and `onMouseDown` handlers are explicitly out of scope.

- [ ] M6V.5 **Port the retired UI 1:1 — owner directive, and it SUPERSEDES piecemeal class
  matching.** The rule, in the owner's words: *all UI should be exactly as in retired except
  for the page rendered that represents the Word doc; all retired styling should be
  preserved 1:1.* The greenfield painter keeps the document canvas — that is the one
  deliberate divergence, and CLAUDE.md already says the canvas stays Word-faithful and
  unthemed. Everything else — toolbar, pickers, rulers, menus, sidebar, header — is a
  VERBATIM port, not a reimplementation.

  This supersedes how M6V.1/M6V.2/M6V.3 were executed. Three rounds of hand-tuning values
  that existed on disk (`h-[30px]` vs `h-8`, `text-[13px]` vs `text-sm`, invented icon `d`
  strings, a bespoke stepper) were each caught by owner review, not by any gate. The
  failure mode is that an approximation looks right to the author and wrong to the person
  who knows the product.

  Port these from `packages/react/src/`, replacing
  ONLY the authority wiring (ProseMirror/retired layout → `Editor.can/exec/query/save/
  getPageGeometry`), never the markup or classes:

  - `components/Toolbar.tsx` and `components/ui/ResponsiveToolbar.tsx` (grouping, overflow)
  - `components/ui/Select.tsx`, `StylePicker.tsx`, `FontPicker.tsx`, `FontSizePicker.tsx`,
    `ColorPicker.tsx`, `LineSpacingPicker.tsx`, `AlignmentButtons.tsx`, `ListButtons.tsx`
  - `components/ui/HorizontalRuler.tsx`, `VerticalRuler.tsx` (margin zones, indent markers)
  - `components/ui/Icons.tsx` (already implemented verbatim; see M6V.4 for the descriptor swap)
  - the demo header in `examples/vite/src/main.tsx` (brand row, framework toggle, the
    chevron button, theme toggle, Open/New/Save)

  Known open detail: the bordered look on the style and font pickers does NOT come from
  those components — both pass only `h-8 text-sm` to `SelectTrigger`, and their call site
  in `Toolbar.tsx` passes no `className`. Find where it does come from before styling it;
  do not invent a border.

  One item is NOT styling and cannot be implemented: the active state on bold/italic. Retired
  read `undoDepth`/mark state off a ProseMirror `EditorState`, which the greenfield
  architecture forbids in adapters. `Editor.can()` answers "may this run?", not "is it
  applied?", so a public query must exist first. Track it separately rather than faking it.

- [ ] M6V.4 **Replace the hand-written toolbar icon paths with the real icon registry.**
  Owner directive, explicit: do not hand-author icon SVG paths. `LEGACY_CHROME_GROUPS` in
  `packages/engine-editor/src/retired-chrome.ts` currently carries locally defined raw `d` strings
  by hand; they are approximations of Material Symbols and must not ship. The authoritative
  sources, per the owner:

  - React registry (**source of truth**):
    `packages/react/src/components/ui/Icons.tsx`
    — 997 lines, ~99 icons, one exported component each, `viewBox="0 -960 960 960"`.
  - Vue component: `packages/vue/src/components/ui/MaterialSymbol.vue`
  - Vue paths: `packages/vue/src/components/ui/icon-paths.json`, GENERATED from the React
    registry by `scripts/extract-icons.mjs` — so Vue is never hand-edited and the two
    adapters cannot drift.

  **Layering decision (made, not open): the descriptor carries icon NAMES; each adapter
  resolves them through its own registry.** Icons are adapter-specific in the retired
  design, while the greenfield descriptor lives in `engine-editor` so both adapters read
  one control list. Carrying names satisfies both: `engine-editor` owns WHICH control
  shows WHICH icon (shared, so the adapters cannot drift on ordering or coverage), and each
  adapter owns HOW that name becomes SVG — which is what keeps `scripts/extract-icons.mjs`
  meaningful, since it regenerates Vue's JSON from React's registry. Moving the registry
  into the shared package would make that generator pointless and put presentation in the
  engine. Core keeps only SVGs tied to framework-independent document behavior.

  Mechanically: replace `paths: readonly string[] | null` on `LegacyChromeControl` with
  `icon: string | null` (the registry's export name minus the `Icon` prefix, e.g.
  `'Undo'`), port `Icons.tsx` verbatim into `packages/react/src/components/ui/`, resolve
  by name in `DocxEditorToolbar.tsx`, and fail loudly on an unknown name rather than
  rendering an empty box. A missing icon must break the build or a test, never render
  blank — CLAUDE.md's existing warning is that a missing name renders raw text.

  **Verified id → registry-name mapping** (control ids from `retired-chrome.ts`, names from
  the registry's `export function Icon*`, both enumerated rather than guessed). Every
  icon-bearing control has an exact counterpart, so nothing needs inventing:

  | control id | icon | control id | icon |
  | --- | --- | --- | --- |
  | `undo` | `Undo` | `redo` | `Redo` |
  | `bold` | `Bold` | `italic` | `Italic` |
  | `underline` | `Underline` | `strikethrough` | `Strikethrough` |
  | `superscript` | `Superscript` | `subscript` | `Subscript` |
  | `fontColor` | `TextColor` | `highlightColor` | `Highlight` |
  | `insertLink` | `Link` | `clearFormatting` | `FormatClear` |
  | `alignLeft` | `AlignLeft` | `alignCenter` | `AlignCenter` |
  | `alignRight` | `AlignRight` | `alignJustify` | `AlignJustify` |
  | `lineSpacing` | `LineSpacing` | `bulletList` | `ListBulleted` |
  | `numberedList` | `ListNumbered` | `decreaseIndent` | `IndentDecrease` |
  | `increaseIndent` | `IndentIncrease` | `insertImage` | `Image` |
  | `imageProperties` | `Tune` | `insertTable` | `Table` |
  | `comments` | `Comment` | `save` | `FileDownload` |

  `style`, `fontFamily`, `fontSize`, `zoom`, and `editingMode` carry no icon today
  (`paths: null` — they render as value dropdowns/steppers); `editingMode` is the one to
  reconsider, since the reference shows a glyph beside "Editing" (`EditNote` is the
  closest registry entry — confirm against the reference before using it).

  **Remaining step, and the one open decision.** The swap itself is mechanical: set
  `icon: <material name>` on the 24 controls and delete the hand-drawn `d` strings. What
  is NOT decided is where the generated paths live so the shared descriptor can use them.
  `scripts/extract-icons.mjs` writes to `packages/vue/src/components/ui/icon-paths.json`,
  and `engine-editor` must not import from `packages/vue` — that inverts the dependency
  DAG. Three options, in preference order:

  1. Have the extractor ALSO emit into `engine-editor` (or a shared location both read),
     keeping one generated source and no cross-adapter import. Preferred.
  2. Keep icons fully adapter-side: the descriptor carries only the name, and each adapter
     resolves it — React through `Icons.tsx`, Vue through its JSON. Matches the retired
     split most closely, but needs a name→component map in React.
  3. Move the registry into the shared package. Rejected earlier: it makes the generator
     pointless and puts presentation in the engine.

  Do not resolve this by importing the Vue JSON from `engine-editor` or from the React
  adapter's test — the test does so today only because it is a test, and that is already
  the loosest link in the chain.

  Pass boundary: no `d=` string is authored by hand anywhere in the chrome path;
  `scripts/extract-icons.mjs` regenerates Vue's JSON from the React registry; a
  fixed-viewport screenshot matches the reference glyph for glyph.

- [ ] M6E.1 **Repoint the `?edit=1` editing smoke suite at the painted surface.** All 14
  `e2e/editorSmoke.ts` tests (7 × React and Vue) fail on a click timeout and have for at
  least 14 commits, predating M6D.1/M6P.1/M6V.1/M6K.1/M6S.1. Root cause, measured: the
  suite clicks `getByTestId('editor-host').locator('p')`, but that paragraph now lives
  inside the hidden input-host shell — computed `opacity: 0`, `pointer-events: none`,
  `clip-path: inset(0px)`, `position: fixed` — so the click can never land. The tests
  target a surface that stopped being interactive when the input host became an
  accessibility/IME projection. They MUST drive the painted pages the way the one-surface
  gates do, not the hidden host. Two of the seven also assert superseded behavior: a
  document with a table now opens `partial`, not read-only (M6P.1). Pass boundary:
  `bun run test:e2e:editor` is green in both adapters with no test clicking a
  `pointer-events: none` element.

- [ ] M6V.2 **Finish retired chrome visual parity — M6V.1 shipped structure, not polish.**
  Owner review of the running editor against `https://latest.docx-editor.dev/react/`
  found the chrome materially worse-looking than the reference. Fixed already: the title
  and menu were rendering as two full-width bands below the header instead of a compact
  column inside it; the ribbon pill was `#f5f5f5` on white, i.e. invisible, and
  edge-to-edge so its rounded ends were off-screen; dropdown carets were literal `▾` text
  glyphs; control groups had no separators; and the demo's status strip sat above the
  product header. Still open: (a) DONE — the vertical ruler is back in
  both adapters, anchored to the page (50% minus half the page width minus its own width)
  and top-aligned with it, instead of rendering in the viewport's left gutter; the visual
  gate asserts its presence again; (b) the toolbar clips at
  the right edge instead of fitting or overflowing into a menu as retired does; (c) the
  split alignment control renders its caret as a detached button; **Owner directive: do NOT hand-roll this CSS.** Build the
  controls the way the old adapter did — `@radix-ui/react-select` for every dropdown
  (style/font/size/colour/alignment/line-spacing/editing-mode), `clsx` for class
  composition, and Tailwind for layout, mirroring
  `packages/react/package.json` and the markup at
  ref `checkpoint-9bb06c38`. Both deps are now installed in `packages/react` (the previous
  `minimumReleaseAge` install blocker no longer reproduces).

  **The port needs no build work — this was verified, not assumed.** Tailwind is already
  wired end to end: `tailwind.config.js` scans `packages/react/src/**/*.{ts,tsx}` and
  `examples/**`, `packages/core/tailwind-preset.cjs` is present and is the shared palette,
  `packages/core/src/styles/editor.css` already carries `@tailwind utilities`, and
  `examples/vite/vite.config.ts:110` loads the plugin against the root config. Utilities
  are therefore live in the adapter today. Diffing `--doc-*` tokens between
  `the shared editor stylesheet` and ours
  returns **zero missing** — the token layer is fully implemented. So the remaining work is
  exactly: replace the hand-rolled control markup and its bespoke CSS with Tailwind
  utilities plus radix `Select`, following the markup at ref `checkpoint-9bb06c38`, and DELETE the
  hand-rolled rules rather than layering over them. Note this intentionally
  cuts against the "adapter CSS is thin, all chrome styling lives in the core
  stylesheet" rule in CLAUDE.md; the owner's instruction takes precedence, and
  `check:adapter-css-thin` will need its scope revisited as part of this task rather
  than worked around. Pass boundary is
  M6V.1's: a fixed-viewport Chrome screenshot compared side by side with the reference.

---

## M6V — Full retired-chrome visual parity

- [ ] M6V.1 **REOPENED (owner visual review — see M6V.2). React-first reference implementation; immediate next delivery task after the in-flight M4-R3/M6-R2 review-fix loop closes.** Port the actual retired React chrome markup, component hierarchy, icon placement, spacing, and CSS component-by-component from presentation reference **the recorded presentation baseline** instead of approximating it with a new generic toolbar. The React root demo MUST show the complete application/title/menu region, full toolbar/ribbon groups, horizontal and vertical rulers, document workspace/page chrome, page indicator, and sidebar/dialog launch surfaces. Existing neutral control metadata may supply labels/icons, but it MUST NOT substitute for the retired component structure or visual layout. Replace only retired authority wiring with PM-free `Editor.can`/`Editor.exec`/`Editor.query`/`Editor.save`/`Editor.getPageGeometry` calls. The only enabled actions are **undo, redo, bold, italic** when `Editor.can(command)` succeeds, plus **save** through `Editor.save()`; underline and every other control remain visible but disabled with a localized unavailable reason. Direct ProseMirror, retired layout/painter, DOM-selection authority, and adapter-owned geometry authority remain forbidden. **React pass boundary:** a fixed-viewport Chrome screenshot is compared side-by-side with the retired React reference in `openspec/changes/interactive-paginated-editing/evidence/m6/retired-visual-parity-react.md`; no named chrome region is missing; every unproven control is observably disabled and cannot dispatch; `bun run test:e2e:react-one-surface-interaction`, `bun run check:adapter-css-thin`, and the adapter-authority test remain green. Do not start Vue visual work until this React gate passes.

  **Mandatory integration boundary:** `packages/react/src/DocxEditor.tsx` itself MUST compose and render the complete chrome and greenfield painted-page surface. Mounting the published `<DocxEditor document={...} />` MUST produce the complete editor without requiring a consumer or example to import and assemble `DocxEditorShell`, title bar, toolbar, rulers, page indicator, or sidebar. Those pieces may remain private implementation details called by `DocxEditor.tsx`; they MUST NOT form a second product root. `examples/shared/DocxAdapterHarness.tsx` is fixture/configuration glue only and MUST NOT own product-shell composition. Visual and interaction gates MUST mount the production `DocxEditor` directly, so a polished wrapper around an incomplete package component cannot satisfy M6V.1.

---

## M6S — Browser-native selection presentation

- [x] M6S.1 Run and record a DOM selection-presentation bake-off on the approved **React** surface between **(a)** merged engine-painted line rectangles, **(b)** a browser-native `Range`/`Selection` projection, and **(c)** CSS Custom Highlight ranges, then adopt the lowest-cost supported projection that matches Word/browser selection fidelity. ProseMirror MUST remain semantic selection owner; the engine MUST remain hit-test and geometry authority; browser selection/highlight state MUST be write-only presentation derived from the current interaction frame and MUST NOT be read back as canonical state. **Pass boundary:** selected spaces, formatting-run boundaries, wrapped lines, paragraph boundaries, ligatures, combining clusters, bidi visual discontinuities, zoom, clipping, and cross-page ranges render without false gaps; copy preserves exact semantic text including whitespace; hidden input focus, IME, accessibility ownership, and pointer/keyboard selection remain unchanged; unsupported browsers fail over to merged engine rectangles. Record compatibility, benchmark results, rejected alternatives, screenshots, and the winner in `openspec/changes/interactive-paginated-editing/evidence/m6/selection-presentation-bakeoff.md`; keep the React interaction, accessibility-tree, and adapter-authority gates green. The chosen policy MUST expose a framework-neutral integration seam, but Vue adoption is deferred to **10V.1**. This task changes presentation performance/fidelity only and MUST NOT widen feature-support claims.

---

## 7. Asynchronous layout, repaint, and failure handling

Deferred until after M6 unless required to unblock a Blocker. Full **5.7**
depends on this section.

- [ ] 7.1 Thread dirty semantic identities and dependency fingerprints from `ModelChange` into incremental layout scheduling without putting layout on the synchronous store transaction path.
- [ ] 7.2 Add cancellable scheduled layout/paint work that prioritizes the active/visible page window and prevents superseded revisions from publishing.
- [ ] 7.3 Publish a replacement interaction frame only after its visible display, semantic index, caret, and selection geometry are complete for the declared window.
- [ ] 7.4 Keep the last coherent frame visible during pending work and safely rebase or reject pointer input received against it.
- [ ] 7.5 Retain committed canonical state and the last coherent frame on layout/paint failure, and emit bounded typed diagnostics without retry storms.
- [ ] 7.6 Instrument input handling, validation/publication, scheduling delay, active-window layout, frame publication, downstream convergence, cancellation, and stale-interaction outcomes.
- [ ] 7.7 Add fake-scheduler tests for rapid typing, remote bursts, configuration/resource changes, cancellation races, failed layout, and older-frame publication attempts.
- [ ] 7-R1 Write `openspec/changes/interactive-paginated-editing/evidence/m7/summary.md`; commit per staging manifest; reopen full **5.7** and **5.8** prerequisites.

---

## 8. Page virtualization, scroll, and large-document gate

- [ ] 8.1 Add viewport and overscan inputs plus an engine-owned mounted-page-window result that includes exact placeholders for unmounted pages.
- [ ] 8.2 Keep the caret/composition page, pointer-captured destination, focused interaction, accessibility focus, and required visible selection pages mounted or materialized before interaction completes.
- [ ] 8.3 Preserve complete semantic selections across unmounted pages and reconstruct equivalent visible overlays when pages remount.
- [ ] 8.4 Implement page-identity/content-offset scroll anchoring when earlier page geometry changes, including a typed fallback when the anchor no longer resolves.
- [ ] 8.5 Implement bounded drag-selection autoscroll that requests destination page windows and never derives positions from placeholder DOM.
- [ ] 8.6 Add deterministic virtualization tests for fast scroll, zoom, page-count changes, long selections, remote repagination, active composition, focus movement, and mount/unmount races.
- [ ] 8.7 Run the representative 300–500-page corpus and record mounted display pages, DOM nodes, ProseMirror nodes/DOM, retained memory, input latency, active-frame latency, scroll work, and downstream convergence against ratified budgets in `openspec/changes/interactive-paginated-editing/evidence/m8/benchmark.md`.
- [ ] 8.8 Keep the complete hidden ProseMirror projection if the gate passes; if it fails for measured projection cost, record evidence and create bounded mounted-window task without changing canonical or public semantics.
- [ ] 8.9 If a bounded ProseMirror window is required, prove selection, IME, history, clipboard, anchors, collaboration, window movement, and public-driver equivalence before enabling it.
- [ ] 8.10 Pass and record the **first formal public `interactive-paginated`** acceptance gate including async frame coherence, virtualization, and ratified performance through both public adapters; update feature-support manifest and docs for the proven body-paragraph matrix only.
- [ ] 8-R1 Write `openspec/changes/interactive-paginated-editing/evidence/m8/summary.md`; stage and commit per staging manifest.

---

## 9. Capability-declared fallback and feature lanes

- [ ] 9.1 Extend capability registration with rendering, hit ownership, selection/navigation, fallback editing, typed editing, save/reopen, paired-adapter, and evidence declarations that default closed.
- [ ] 9.2 Add a shared precommit fallback guard that checks exact ownership, accepted ProseMirror steps, semantic operation mapping, boundary crossing, and preservation obligations before store mutation.
- [ ] 9.3 Add reverse-reconciliation and rejection tests proving unsupported fallback intent cannot leak into canonical state or move selection into an invalid projection.
- [ ] 9.4 Run the separate body-paragraph feature-WYSIWYG comparator bundle for the exact supported text/mark/paragraph matrix and update that claim only if authored, style, shaping, pagination, display, interaction, accessibility, DOCX, and relevant output evidence passes.
- [ ] 9.5 Complete the first table `interactive-paginated` lane for owned cell text, cell hit ownership, caret/navigation, cell selection geometry, boundary rejection, fragmentation geometry, paired adapters, and save/reopen; keep row/column, merge/split, dimensions, borders, shading, header-row, and other unproven operations read-only.
- [ ] 9.6 Run the separate table feature-WYSIWYG comparator bundle for the exact proven table matrix and update only that matrix's claim.
- [ ] 9.7 Complete the first image `interactive-paginated` lane for atomic hit ownership, node selection, keyboard traversal, supported delete/replace commands, wrap/transform geometry, paired adapters, read-only unsupported handles, and save/reopen.
- [ ] 9.8 Run the separate image feature-WYSIWYG comparator bundle for the exact proven image matrix and update only that matrix's claim.
- [ ] 9.9 Define a repeatable two-gate lane checklist for controls, links, headers/footers, annotations, notes, fields, shapes, and later features so each can land independently without widening existing claims.
- [ ] 9.10 Add hostile and preservation fixtures proving fallback edits retain unowned XML children, attributes, relationships, media, extension markup, and preservation capsules byte-equivalently where required.
- [ ] 9-R1 Commit each feature lane tranche separately with manifest updates.

---

## 10. Accessibility, parity, claims, and final gates

- [ ] 10.1 Complete the single semantic/accessibility projection for every claimed feature lane with reading order, roles, names, editability, selection, current focus, and actions mapped to canonical semantic identities.
- [ ] 10.2 Prove accessibility focus can request virtualized content without identity loss and that pointer, keyboard, and accessibility actions produce equivalent semantic commands.
- [ ] 10.3 Run identical engine-neutral `EditorDriver` interaction suites against installed-style React and Vue packages with no private ProseMirror or engine-module access.
- [ ] 10.4 Verify that every feature-WYSIWYG claim has its own comparator bundle for authored state, resolved style, shaping/layout, display geometry, interaction geometry, semantic/accessibility output, DOCX save/reopen, and relevant PDF/print output.
- [ ] 10.5 Update the feature-support matrix and docs to claim only the exact rendered, read-only, fallback-editable, typed-editable, interactive-paginated, or feature-WYSIWYG matrix proven by evidence.
- [ ] 10.6 Add a guard that fails CI if paginated preview repaint alone is labeled interactive-paginated/WYSIWYG or if diagnostic split mode is used as acceptance evidence.
- [ ] 10V.1 **Final implementation tranche: mechanically port the completed React chrome and selection presentation to Vue.** Reproduce the approved React component structure and behavior using the same core stylesheet, neutral metadata, i18n keys, public `Editor` contracts, enabled-action allowlist, disabled-control policy, and M6S.1 selection-presentation seam. Do not redesign, independently approximate, or introduce a second Vue model. **Pass boundary:** fixed-viewport React and Vue screenshots match materially; no named region, control, order, spacing class, disabled state, selection behavior, or root-demo behavior differs; Vue and paired interaction suites, export parity, adapter CSS, accessibility-tree, and adapter-authority gates are green. Record the final parity evidence in `openspec/changes/interactive-paginated-editing/evidence/m10/vue-final-parity.md`. Complete this before 10.7 so final verification and independent review cover the port.
- [ ] 10.7 Run targeted typecheck, unit/property tests, paired adapter parity, API extraction, i18n validation where strings changed, browser interaction suites, save/reopen fixtures, security checks, and representative performance gates.
- [ ] 10.8 Obtain independent architecture, interaction, accessibility, security, and performance review with no open Blocker/High finding before marking the capability apply-complete.
- [ ] 10-R1 Final commit per staging manifest and mark change apply-complete only after 10.8 passes.

---

## Review severity and delivery-speed policy

- Only **Blocker, Critical, or High** findings block the current task, milestone, claim, or independent-review gate. Fix them with a focused regression test, scoped verification, one commit, and a fresh independent re-review of the affected risk area.
- **Medium and Low** findings MUST be recorded with evidence in the current review artifact or follow-up backlog, but MUST NOT interrupt the accelerated critical path, trigger unrelated refactoring, or require another review cycle. Fix one immediately only when it directly fails an explicit task gate or credible evidence upgrades it to Blocker/Critical/High.
- Review agents MUST classify findings by demonstrated impact rather than hypothetical polish. Once all Blocker/Critical/High findings are closed on the current HEAD, the review gate passes; do not continue open-ended review/fix loops for lower severities.
- Granular tasks run their focused tests and package checks. Full repository, paired-browser, accessibility, performance, and independent-review bundles run only at the milestone/task gates that explicitly require them.
- Pre-existing or unrelated failures are confirmed once against the declared baseline, recorded, and left untouched unless they block an explicit gate owned by this change.

---

## Granular commit protocol (every accelerated task)

Each counted checkbox through **10V.1** ends with exactly **one normal commit**.
Unrelated dirty files MUST remain unstaged. No milestone summary commits. No git tags.

> **The staging manifest is NOT a complete record of this change's commits, and
> should not be read as one.** A round-3 evidence audit found 16 of 51 commits in
> `checkpoint-90e74c0a..checkpoint-e3a55ad9` carrying no checkbox and no manifest row, several of them
> changing `engine-layout`, `engine-editor`, and the core stylesheet — plus one
> commit (`checkpoint-78c75dee`) landing five checkboxes (M4.2–M4.6) at once against the
> one-commit rule, with no amendment note.
>
> Two distinct causes, worth separating:
>
> - **Review-fix and gate-repair commits have no checkbox by design.** Findings
>   from independent review are not tasks, so there is no manifest row to match.
>   These are expected to be unrepresented, and the protocol should have said so.
> - **`checkpoint-78c75dee` is a real protocol violation**, recorded here rather than
>   rewritten, since the history is the record.
>
> To reconstruct what a commit staged, use `git log`/`git show`, not this manifest.
> Preserve-list discipline, unlike commit granularity, was independently verified
> clean across the whole range: no commit staged
> `packages/engine-core/src/package/docx/read.ts`,
> `packages/engine-core/src/package/preservation-capsule.ts`, or
> `docs/api/docx-editor-{react,vue}/*`.

1. Run task verification commands; write results into the task's evidence file when listed.
2. Stage **only** the literal paths in that task's staging manifest row.
3. Assert: `git diff --cached --name-only | sort` equals the manifest sorted.
4. Run `git diff --cached --check`.
5. When manifest includes code under `packages/` or `examples/`, run §Staged security check on the same path list.
6. Commit with a conventional message naming the task id.
7. Post progress: `interactive-paginated-editing: 33/120 — 5.6a complete`.

### Staged security check (fail closed)

Use the task's literal `STAGED_PATHS` from the manifest. **Expected: zero pattern matches, exit 0.**

```bash
STAGED_PATHS=(
  packages/react/src/DocxEditor.tsx
)
TMP_ADDED="$(mktemp)"
TMP_PLUS="$(mktemp)"
TMP_LINES="$(mktemp)"
trap 'rm -f "$TMP_ADDED" "$TMP_PLUS" "$TMP_LINES"' EXIT

if ! git diff --cached --unified=0 -- "${STAGED_PATHS[@]}" >"$TMP_ADDED"; then
  echo "security: git diff --cached failed" >&2
  exit 1
fi

rg '^\+' "$TMP_ADDED" >"$TMP_PLUS"
plus_status=$?
if [ "$plus_status" -gt 1 ]; then
  echo "security: added-line search failed ($plus_status)" >&2
  exit 1
fi

if [ "$plus_status" -eq 0 ]; then
  rg -v '^\+\+\+' "$TMP_PLUS" >"$TMP_LINES"
  lines_status=$?
  if [ "$lines_status" -gt 1 ]; then
    echo "security: diff-header filtering failed ($lines_status)" >&2
    exit 1
  fi
else
  : >"$TMP_LINES"
fi

rg -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|window\.open\(|\.href\s*=|font-family:.*\$\{' "$TMP_LINES" >/dev/null
match_status=$?
case "$match_status" in
  0)
    rg -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|window\.open\(|\.href\s*=|font-family:.*\$\{' "$TMP_LINES" >&2
    echo "security: forbidden sink in staged diff" >&2
    exit 1
    ;;
  1)
    exit 0
    ;;
  *)
    echo "security: rg infrastructure error ($match_status)" >&2
    exit 1
    ;;
esac
```

### Per-task staging manifests (M0–M6)

| Task | Stage exactly |
| --- | --- |
| **M0-R1** | `openspec/changes/interactive-paginated-editing/evidence/m0/baseline-verification.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M0-R2** | `openspec/changes/interactive-paginated-editing/evidence/m0/authority-review.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **5.5** | `packages/engine-editor/src/keyboard-navigation.ts`, `packages/engine-editor/src/navigation-session.ts`, `packages/engine-editor/src/navigation-stops.ts`, `packages/engine-editor/src/navigation-geometry.ts`, `packages/engine-editor/src/line-catalog.ts`, `packages/engine-editor/test/keyboard-navigation.test.ts`, `packages/engine-editor/test/navigation-session.test.ts`, `packages/engine-editor/test/navigation-production.test.ts`, `packages/engine-editor/test/line-catalog.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **5.6a** | `packages/engine-editor/src/interaction-planner.ts`, `packages/engine-editor/test/interaction-planner.test.ts`, `packages/engine-editor/test/line-whitespace-ownership.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **5.7a** | `packages/engine-editor/src/interaction-planner.ts`, `packages/engine-editor/test/interaction-planner.test.ts`, `packages/engine-editor/test/navigation-sidecar.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (planner replaces the originally-listed `navigation-session.ts`: synchronous target re-resolution belongs beside the other planner preconditions, not in the visual-advance sidecar) |
| **M1-R1** | `openspec/changes/interactive-paginated-editing/evidence/m1/verification-log.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M1-R2** | `openspec/changes/interactive-paginated-editing/evidence/m1/summary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **6.1** | `packages/core/src/styles/editor.css`, `packages/react/src/styles/editor.css`, `packages/vue/src/styles/editor.css`, `openspec/changes/interactive-paginated-editing/tasks.md` (both adapter stylesheets were deleted by the greenfield strip `checkpoint-701c1a9f`, which left `check:adapter-css-thin` failing on a missing file; recreated import-only so the M2-R1 gate measures the invariant instead of an ENOENT) |
| **M2.1** | `packages/engine-editor/src/adapter-event-bridge.ts`, `packages/engine-editor/src/index.ts`, `packages/engine-editor/test/adapter-event-bridge.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (`index.ts` added: an unexported bridge cannot be "consumed identically by React/Vue hosts") |
| **M2.2** | `packages/engine-editor/src/display-bridge.ts`, `packages/engine-editor/src/index.ts`, `packages/react/src/paintDisplay.tsx`, `packages/vue/src/paintDisplay.ts`, `packages/engine-editor/test/display-bridge.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (`index.ts` added: both adapters import the overlay helpers through the package entry) |
| **M2.3** | `packages/engine-output/src/dom.ts`, `packages/engine-editor/src/display-bridge.ts`, `packages/engine-editor/src/index.ts`, `packages/react/src/paintDisplay.tsx`, `e2e/oneSurfaceHelpers.ts`, `packages/engine-editor/test/display-bridge.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (target selection is engine geometry, so it lives in `display-bridge.ts` and is exported; Vue stamps the same attribute at 6.3 per the React-first M3 sequencing) |
| **M2-R1** | `openspec/changes/interactive-paginated-editing/evidence/m2/verification-log.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M2-R2** | `openspec/changes/interactive-paginated-editing/evidence/m2/summary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **6.2** | `packages/react/src/DocxEditor.tsx`, `packages/react/src/../../engine-editor/src/adapter-event-bridge.ts`, `packages/react/test/docx-editor-one-surface.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (bridge element shape widened so a real `HTMLElement` satisfies it — found only when React first compiled against the M2.1 bridge) |
| **6.4** | `packages/react/src/paintDisplay.tsx`, `packages/engine-editor/src/display-bridge.ts`, `packages/engine-editor/test/display-bridge.test.ts`, `packages/core/src/styles/editor.css`, `openspec/changes/interactive-paginated-editing/tasks.md` (collapsed-caret fix belongs in `overlaysForFrame`, not in per-adapter paint, or React and Vue would each need it) |
| **M3.1** | `e2e/react-one-surface.interaction.spec.ts`, `e2e/oneSurfaceHelpers.ts`, `e2e/editor-smoke.config.ts`, `package.json`, `packages/engine-editor/src/adapter-event-bridge.ts`, `packages/engine-editor/test/adapter-event-bridge.test.ts`, `examples/shared/DocxAdapterHarness.tsx`, `openspec/changes/interactive-paginated-editing/tasks.md` (config `testMatch` had to accept `*.interaction.spec.ts` or the spec is never discovered; the bridge fixes are the two product bugs this spec caught)
| **M3.2** | `openspec/changes/interactive-paginated-editing/evidence/m3/manual-chrome-checklist.md`, `packages/react/src/DocxEditor.tsx`, `packages/core/src/styles/editor.css`, `openspec/changes/interactive-paginated-editing/tasks.md` (the manual pass found the surface was outside `.ep-root` and that two tokens had no light-mode value; fixing what the checklist found beats recording it as broken) |
| **M3-R1** | `openspec/changes/interactive-paginated-editing/evidence/m3/verification-log.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M3-R2** | `openspec/changes/interactive-paginated-editing/evidence/m3/summary.md`, `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M4.0** | `packages/react/src/toolbarCommands.ts`, `packages/react/src/index.ts`, `packages/react/test/toolbarCommands.test.ts`, `packages/engine-binding/src/edit-surface.ts`, `packages/engine-binding/src/index.ts`, `packages/engine-editor/src/create-editor.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (`Editor.can`/`exec` supported only `setSelection`, so the engine command path had to land too. **`api:check` resolved after independent review:** it was never run and was failing. Both packages were rebuilt so `dist` matches `src`, both snapshots re-extracted and now contain this change's ~14 new exports per adapter symmetrically, and `api:check` passes for React and Vue. The snapshot files remain UNTRACKED and unstaged, per the preserve-list.)
| **M4.1** | `openspec/changes/interactive-paginated-editing/evidence/m4/inventory.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M4.2** | `packages/react/src/DocxEditorShell.tsx`, `packages/react/src/index.ts`, `packages/core/src/styles/editor.css`, `examples/shared/DocxAdapterHarness.tsx`, `openspec/changes/interactive-paginated-editing/tasks.md` (shell must be exported and mounted, or M4-R1 cannot prove the M3 flow still works through it)
| **M4.3** | `packages/react/src/DocxEditorTitleBar.tsx`, `packages/react/src/PageIndicator.tsx`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M4.4** | `packages/react/src/HorizontalRuler.tsx`, `packages/react/src/VerticalRuler.tsx`, `packages/react/src/rulerTicks.ts`, `packages/react/test/rulerTicks.test.ts`, `packages/core/src/styles/editor.css`, `openspec/changes/interactive-paginated-editing/tasks.md` (tick geometry split out so it is testable without a DOM)
| **M4.5** | `packages/react/src/DocxEditorToolbar.tsx`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M4.6** | `packages/react/src/DocxEditorSidebar.tsx`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M4.7** | `openspec/changes/interactive-paginated-editing/evidence/m4/demo-boundary.md`, `examples/vite/src/App.tsx`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M4-R1** | `openspec/changes/interactive-paginated-editing/evidence/m4/verification-log.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M4-R2** | `openspec/changes/interactive-paginated-editing/evidence/m4/manual-chrome-shell.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M4-R3** | `openspec/changes/interactive-paginated-editing/evidence/m4/summary.md`, `packages/react/src/useEditorSnapshot.ts`, `packages/react/src/DocxEditorToolbar.tsx`, `packages/react/src/HorizontalRuler.tsx`, `packages/react/src/VerticalRuler.tsx`, `packages/react/src/PageIndicator.tsx`, `packages/react/src/index.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (self-review found the chrome never re-rendered; fixing beats recording it). **Checkbox intentionally left unchecked — the gate needs an INDEPENDENT reviewer, and a self-review is not one.** |
| **6.3** | `packages/vue/src/DocxEditor.ts`, `packages/vue/src/paintDisplay.ts`, `packages/vue/test/docx-editor-one-surface.test.ts`, `examples/vue/src/styles.css`, `examples/vue/src/main.ts`, `examples/shared/DocxAdapterHarness.vue`, `openspec/changes/interactive-paginated-editing/tasks.md` (the Vue demo never imported the core stylesheet, so it had no `--doc-*` tokens at all and painted caret/selection/page transparent)
| **M5.1** | `packages/vue/src/DocxEditorShell.ts`, `packages/vue/src/DocxEditorToolbar.ts`, `packages/vue/src/HorizontalRuler.ts`, `packages/vue/src/VerticalRuler.ts`, `packages/vue/src/DocxEditorTitleBar.ts`, `packages/vue/src/PageIndicator.ts`, `packages/vue/src/useEditorSnapshot.ts`, `packages/vue/src/DocxEditorSidebar.ts`, `packages/vue/src/index.ts`, `packages/engine-editor/src/ruler-ticks.ts`, `packages/engine-editor/src/toolbar-commands.ts`, `packages/engine-editor/src/index.ts`, `packages/engine-editor/test/ruler-ticks.test.ts`, `packages/engine-editor/test/toolbar-commands.test.ts`, `packages/react/src/rulerTicks.ts`, `packages/react/src/toolbarCommands.ts`, `examples/shared/DocxAdapterHarness.vue`, `openspec/changes/interactive-paginated-editing/tasks.md` (**`.ts` not `.vue`**: this package is SFC-free and typechecks with plain `tsc`, so a `.vue` file needs `vue-tsc` or a shim that erases prop types. Ruler ticks and toolbar can/exec moved into the engine — platform-agnostic logic belongs in core called by both adapters, not duplicated per framework.)
| **M5.2** | `e2e/vue-one-surface.interaction.spec.ts`, `package.json`, `examples/shared/DocxAdapterHarness.vue`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M5-R1** | `openspec/changes/interactive-paginated-editing/evidence/m5/verification-log.md`, `packages/engine-editor/src/create-editor.ts`, `scripts/check-parity-contract.mjs`, `scripts/parity/parity.contract.json`, `openspec/changes/interactive-paginated-editing/tasks.md` (the gate exposed a real input-host scroll defect, and `check:parity-contract` was measuring a pre-greenfield surface; both fixed in tracked files, neither preserve-listed API snapshot touched)
| **M5-R2** | `openspec/changes/interactive-paginated-editing/evidence/m5/summary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **6.5** | `e2e/paired-one-surface.interaction.spec.ts`, `package.json`, `packages/engine-editor/src/display-bridge.ts`, `packages/engine-editor/test/display-bridge.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (the paired gate found the adapters disagreeing on initial caret visibility; fixed in the shared helper so both agree)
| **6.6** | `examples/vite/src/main.tsx`, `examples/vue/src/main.ts`, `openspec/changes/interactive-paginated-editing/evidence/m4/demo-boundary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` (the default switch lives in the ROUTING entrypoints, not in the museum `App` components, which stay untouched behind `?museum=1`)
| **M6.1** | `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M6-R1** | `openspec/changes/interactive-paginated-editing/evidence/m6/verification-log.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M6-R2** | `openspec/changes/interactive-paginated-editing/evidence/m6/manual-chrome-paired.md`, `openspec/changes/interactive-paginated-editing/evidence/m6/summary.md`, `openspec/changes/interactive-paginated-editing/tasks.md`. **Checkbox intentionally left unchecked — the manual paired pass is done and recorded, but the task also requires an INDEPENDENT review, and the evidence in this directory is author-produced. Same reason M4-R3 is open.** |
| **M6D.1** | `examples/vite/src/main.tsx`, `examples/vite/vite.config.ts`, `e2e/react-default-comprehensive-fixture.spec.ts`, `package.json`, `openspec/changes/interactive-paginated-editing/evidence/m6/default-comprehensive-fixture.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M6P.1** | `packages/engine-core/src/package/docx/read.ts`, `packages/engine-core/src/package/index.ts`, `packages/engine-core/test/partial-body-editability.test.ts`, `packages/engine-binding/src/session.ts`, `packages/engine-binding/src/binding.ts`, `packages/engine-binding/src/edit-surface.ts`, `packages/engine-binding/src/semantic-ownership.ts`, `packages/engine-binding/test/partial-body-editability.test.ts`, `packages/engine-editor/src/create-editor.ts`, `packages/engine-editor/test/partial-body-editability.test.ts`, `e2e/react-partial-body-editability.spec.ts`, `package.json`, `openspec/changes/interactive-paginated-editing/evidence/m6/partial-body-editability-react.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M6K.1** | `packages/engine-binding/src/edit-surface.ts`, `packages/engine-binding/src/input-policy.ts`, `packages/engine-binding/test/input-events.test.ts`, `packages/engine-editor/src/adapter-event-bridge.ts`, `packages/engine-editor/test/adapter-event-bridge.test.ts`, `packages/react/src/DocxEditor.tsx`, `e2e/react-prosemirror-command-parity.spec.ts`, `package.json`, `openspec/changes/interactive-paginated-editing/evidence/m6/prosemirror-command-parity.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M6S.1** | `packages/engine-editor/src/selection-presentation.ts`, `packages/engine-editor/src/index.ts`, `packages/engine-editor/test/selection-presentation.test.ts`, `packages/react/src/paintDisplay.tsx`, `packages/vue/src/paintDisplay.ts`, `packages/core/src/styles/editor.css`, `e2e/paired-selection-presentation.spec.ts`, `package.json`, `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md`, `openspec/changes/interactive-paginated-editing/evidence/m6/selection-presentation-bakeoff.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M6V.1** | `packages/react/src/DocxEditor.tsx`, `packages/react/src/types.ts`, `packages/react/src/DocxEditorShell.tsx`, `packages/react/src/DocxEditorTitleBar.tsx`, `packages/react/src/DocxEditorToolbar.tsx`, `packages/react/src/DocxEditorSidebar.tsx`, `packages/react/src/index.ts`, `packages/react/test/docx-editor-retired-chrome.test.ts`, `packages/core/src/styles/editor.css`, `examples/shared/DocxAdapterHarness.tsx`, `e2e/react-retired-chrome.visual.spec.ts`, `package.json`, `openspec/changes/interactive-paginated-editing/evidence/m6/retired-visual-parity-react.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **10V.1** | `packages/vue/src/DocxEditorShell.ts`, `packages/vue/src/DocxEditorTitleBar.ts`, `packages/vue/src/DocxEditorToolbar.ts`, `packages/vue/src/DocxEditorSidebar.ts`, `packages/vue/src/paintDisplay.ts`, `packages/vue/src/index.ts`, `packages/core/src/styles/editor.css`, `examples/shared/DocxAdapterHarness.vue`, `e2e/paired-retired-chrome.visual.spec.ts`, `e2e/paired-selection-presentation.spec.ts`, `package.json`, `openspec/changes/interactive-paginated-editing/evidence/m10/vue-final-parity.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **7-R1** | `openspec/changes/interactive-paginated-editing/evidence/m7/summary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **8.7** | `openspec/changes/interactive-paginated-editing/evidence/m8/benchmark.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **8-R1** | `openspec/changes/interactive-paginated-editing/evidence/m8/summary.md`, `openspec/changes/interactive-paginated-editing/evidence/m8/benchmark.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **10-R1** | `openspec/changes/interactive-paginated-editing/tasks.md`, `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md`, `openspec/changes/interactive-paginated-editing/proposal.md` |
