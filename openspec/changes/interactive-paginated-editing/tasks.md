# Interactive paginated editing — accelerated execution tasks

Progress: **69 / 114** complete.

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

- [ ] 6.5 Create `e2e/paired-one-surface.interaction.spec.ts` and `package.json` script `test:e2e:paired-one-surface-interaction` covering React + Vue bounded-document fixture through the one-surface path (click target → type → selection → `Editor.can({ type: 'toggleMark', mark: 'bold' })` then `Editor.exec({ type: 'toggleMark', mark: 'bold' })` → clipboard → synthetic composition → undo/redo → **`Editor.save()`** reopen). **Deliverable:** paired spec green; supersedes separate React/Vue rows in CI when wired.
- [x] 6.6 Make split edit/preview explicitly diagnostic; remove from normal demo startup after paired preview baseline passes. **Deliverable:** default preview demo uses greenfield one-surface + shell; `?edit=1` diagnostic only.
- [x] M6.1 Update `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md` and internal preview notes for **paired bounded-document internal/preview alpha**; feature-support manifest and public docs MUST remain below `interactive-paginated`. **Deliverable:** honesty rules explicit that **8.10** is first public claim.
- [ ] M6-R1 Run: `bun run verify:real-adapter-smoke`; `bun run verify:real-adapter-gate`; `bun run verify:a11y-tree`; `bun run test:e2e:paired-one-surface-interaction`; `bun run check:parity-contract`; `bun run typecheck`; `openspec validate interactive-paginated-editing --strict`; `git diff --cached --check`; `git diff --check`. Write results to `openspec/changes/interactive-paginated-editing/evidence/m6/verification-log.md`. Stage and commit per staging manifest.
- [ ] M6-R2 Manual paired preview checklist in `openspec/changes/interactive-paginated-editing/evidence/m6/manual-chrome-paired.md` (Vue `http://127.0.0.1:5274/?realAdapter=1` and React `http://127.0.0.1:5273/?realAdapter=1`); independent review (no Blocker/High); write `openspec/changes/interactive-paginated-editing/evidence/m6/summary.md`; mark **6.5** and **6.6** complete; stage and commit per staging manifest. **Allowed:** internal/preview alpha — **not** public `interactive-paginated`.

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
- [ ] 10.7 Run targeted typecheck, unit/property tests, paired adapter parity, API extraction, i18n validation where strings changed, browser interaction suites, save/reopen fixtures, security checks, and representative performance gates.
- [ ] 10.8 Obtain independent architecture, interaction, accessibility, security, and performance review with no open Blocker/High finding before marking the capability apply-complete.
- [ ] 10-R1 Final commit per staging manifest and mark change apply-complete only after 10.8 passes.

---

## Granular commit protocol (every accelerated task)

Each counted checkbox through **M6-R2** ends with exactly **one normal commit**.
Unrelated dirty files MUST remain unstaged. No milestone summary commits. No git tags.

1. Run task verification commands; write results into the task's evidence file when listed.
2. Stage **only** the literal paths in that task's staging manifest row.
3. Assert: `git diff --cached --name-only | sort` equals the manifest sorted.
4. Run `git diff --cached --check`.
5. When manifest includes code under `packages/` or `examples/`, run §Staged security check on the same path list.
6. Commit with a conventional message naming the task id.
7. Post progress: `interactive-paginated-editing: 33/114 — 5.6a complete`.

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
| **M4.0** | `packages/react/src/toolbarCommands.ts`, `packages/react/src/index.ts`, `packages/react/test/toolbarCommands.test.ts`, `packages/engine-binding/src/edit-surface.ts`, `packages/engine-binding/src/index.ts`, `packages/engine-editor/src/create-editor.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (`Editor.can`/`exec` supported only `setSelection`, so the engine command path had to land too; `docs/api/docx-editor-react/index.api.md` NOT staged — it is untracked, on the goal's preserve-list, and extracts from a stale `dist`, so it needs a rebuild in its own step)
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
| **M5.1** | `packages/vue/src/DocxEditorShell.ts`, `packages/vue/src/DocxEditorToolbar.ts`, `packages/vue/src/HorizontalRuler.ts`, `packages/vue/src/VerticalRuler.ts`, `packages/vue/src/DocxEditorTitleBar.ts`, `packages/vue/src/PageIndicator.ts`, `packages/vue/src/useEditorSnapshot.ts`, `packages/vue/src/index.ts`, `packages/engine-editor/src/ruler-ticks.ts`, `packages/engine-editor/src/toolbar-commands.ts`, `packages/engine-editor/src/index.ts`, `packages/engine-editor/test/ruler-ticks.test.ts`, `packages/engine-editor/test/toolbar-commands.test.ts`, `packages/react/src/rulerTicks.ts`, `packages/react/src/toolbarCommands.ts`, `examples/shared/DocxAdapterHarness.vue`, `openspec/changes/interactive-paginated-editing/tasks.md` (**`.ts` not `.vue`**: this package is SFC-free and typechecks with plain `tsc`, so a `.vue` file needs `vue-tsc` or a shim that erases prop types. Ruler ticks and toolbar can/exec moved into the engine — platform-agnostic logic belongs in core called by both adapters, not duplicated per framework.)
| **M5.2** | `e2e/vue-one-surface.interaction.spec.ts`, `package.json`, `examples/shared/DocxAdapterHarness.vue`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M5-R1** | `openspec/changes/interactive-paginated-editing/evidence/m5/verification-log.md`, `packages/engine-editor/src/create-editor.ts`, `scripts/check-parity-contract.mjs`, `scripts/parity/parity.contract.json`, `openspec/changes/interactive-paginated-editing/tasks.md` (the gate exposed a real input-host scroll defect, and `check:parity-contract` was measuring a pre-greenfield surface; both fixed in tracked files, neither preserve-listed API snapshot touched)
| **M5-R2** | `openspec/changes/interactive-paginated-editing/evidence/m5/summary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **6.5** | `e2e/paired-one-surface.interaction.spec.ts`, `package.json`, `packages/engine-editor/src/display-bridge.ts`, `packages/engine-editor/test/display-bridge.test.ts`, `openspec/changes/interactive-paginated-editing/tasks.md` (the paired gate found the adapters disagreeing on initial caret visibility; fixed in the shared helper so both agree)
| **6.6** | `examples/vite/src/main.tsx`, `examples/vue/src/main.ts`, `openspec/changes/interactive-paginated-editing/evidence/m4/demo-boundary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` (the default switch lives in the ROUTING entrypoints, not in the museum `App` components, which stay untouched behind `?museum=1`)
| **M6.1** | `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M6-R1** | `openspec/changes/interactive-paginated-editing/evidence/m6/verification-log.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **M6-R2** | `openspec/changes/interactive-paginated-editing/evidence/m6/manual-chrome-paired.md`, `openspec/changes/interactive-paginated-editing/evidence/m6/summary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **7-R1** | `openspec/changes/interactive-paginated-editing/evidence/m7/summary.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **8.7** | `openspec/changes/interactive-paginated-editing/evidence/m8/benchmark.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **8-R1** | `openspec/changes/interactive-paginated-editing/evidence/m8/summary.md`, `openspec/changes/interactive-paginated-editing/evidence/m8/benchmark.md`, `openspec/changes/interactive-paginated-editing/tasks.md` |
| **10-R1** | `openspec/changes/interactive-paginated-editing/tasks.md`, `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md`, `openspec/changes/interactive-paginated-editing/proposal.md` |
