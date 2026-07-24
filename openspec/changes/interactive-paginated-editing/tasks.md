## 1. Authority, status, and conformance vocabulary

- [x] 1.1 Replace every landed "WYSIWYG" checkpoint that currently proves only model-to-preview repaint with "paginated preview repaint", and link direct editing completion to this change.
- [x] 1.2 Add the rendered, interactive-read-only, fallback-editable, typed-editable, interactive-paginated, and feature-WYSIWYG states to the shared feature-support manifest without changing unrelated feature claims.
- [x] 1.3 Cross-reference this change from the binding, layout, partial-editability, paired-adapter, package-topology, and comprehensive coverage tasks that supply prerequisites; retain their independent completion gates.
- [x] 1.4 Add an authority/import test proving adapters cannot import ProseMirror, implement document geometry, or bypass the public `Editor`/`EditorHost` facade.
- [x] 1.5 Freeze the supported browser/platform matrix for pointer, keyboard, clipboard, IME, accessibility, and mobile/virtual-keyboard evidence before implementation claims begin.

## 2. Interaction contracts and immutable frames

- [x] 2.1 Add PM-free contracts for interaction-frame identity, model/layout revisions, semantic hit targets, caret geometry, selection geometry, focus/composition state, and typed stale/pending/read-only/invalid outcomes.
- [x] 2.2 Extend the public editor facade so display, page geometry, selection, caret, and hit-test results can be consumed from one provably coherent interaction frame.
- [x] 2.3 Implement immutable interaction-frame construction in `engine-editor`, including selection-only frames that safely reuse an unchanged layout revision.
- [x] 2.4 Publish frame replacement atomically and retain the last complete frame while newer derived work is pending.
- [x] 2.5 Add adversarial tests that interleave selection changes, model commits, resource/configuration epoch changes, cancelled layout, and adapter reads and prove no mixed-revision geometry is observable.
- [x] 2.6 Define engine-neutral `EditorDriver` operations and observations for client-coordinate pointer input, semantic selection, current page, frame identity, caret/range geometry, focus, composition, and typed rejected interaction.

## 3. Semantic positions, clusters, and geometry

- [x] 3.1 Freeze geometry fixtures for empty/trailing paragraphs, tabs, whitespace, combining characters, surrogate pairs, ligatures, RTL/bidi runs, vertical movement, page boundaries, transformed items, table cells, atomic images, and read-only content.
- [x] 3.2 Replace provisional display-item accumulated offsets with model-derived story/scope, stable semantic identity, grapheme offset or atomic target, and affinity indexes.
- [x] 3.3 Emit shaped-cluster-to-semantic-position maps that preserve grapheme boundaries, bidi affinity, logical order, and deterministic tie breaking.
- [x] 3.4 Emit explicit caret stops and ownership regions for empty paragraphs, trailing positions, line areas, structural boundaries, and capability-owned whitespace.
- [x] 3.5 Implement client-to-content coordinate conversion through scroll, zoom, page offsets, clipping, writing mode, and invertible item transforms.
- [x] 3.6 Implement reverse-z-order hit testing with pointer-transparent decoration, clipping, hit ownership, interaction roles, and fail-closed non-invertible transforms.
- [x] 3.7 Implement engine-derived collapsed caret rectangles with page, clipping, writing direction, transform, and affinity data.
- [x] 3.8 Implement engine-derived visible rectangles for text and currently supported node/table-cell/control/story/annotation selections while retaining complete semantic ranges offscreen.
- [x] 3.9 Add deterministic and property tests for semantic-position round trips, coordinate-transform round trips, cluster edge ties, empty content, overlap/z-order, clipping, and malformed geometry.

## 4. Hidden input-host falsification gate

- [x] 4.1 Mount the ProseMirror input host attached and non-`display:none`, keep it outside visible layout authority, and prevent duplicate visible or assistive document content.
- [x] 4.2 Synchronize engine semantic selection to ProseMirror before focus/native input and preserve the engine selection across blur, owned popups, projection reconciliation, and remote changes.
- [x] 4.3 Prototype the selected clipped/repositioned input-host technique near the engine caret and record how browser IME/input UI follows the active caret on the supported platform matrix.
- [x] 4.4 Add composition tests for start/update/end/cancel, repeated updates, blur, dead keys, surrogate pairs, combining clusters, RTL input, remote invalidation, and capability-boundary rejection with no duplicate or lost text.
- [x] 4.5 Add clipboard, beforeinput, drag/drop, keyboard-command, mobile/virtual-keyboard, and focus-transfer tests proving events use existing bounded parsing and store-first validation.
- [x] 4.6 Implement the minimum single semantic/accessibility projection required for the body-paragraph gate, including reading order, editability, focus, and selection mapped to canonical identities.
- [x] 4.7 Add accessibility-tree tests proving the hidden ProseMirror projection and engine semantic projection do not expose duplicate documents or contradictory focus/editability.
- [x] 4.8 Run the browser/platform gate through public adapter builds and either approve the hidden-host mechanism with recorded evidence or stop and revise it before page-interaction work continues.

## 5. Shared pointer and keyboard interaction controller

- [ ] 5.1 Implement a framework-neutral interaction controller that accepts host metrics and native event intent and returns ProseMirror selection/command requests through `EditorBinding`, focus, capture, scroll, or typed rejection effects without owning parallel selection state.
- [ ] 5.2 Implement single-click caret placement and shift-click extension through frame-bound hit targets and `EditorBinding`.
- [ ] 5.3 Implement Unicode-aware double-click word and capability-owned triple-click block selection without splitting grapheme clusters.
- [ ] 5.4 Implement pointer-drag selection with capture across lines and pages, preserving semantic anchors when layout frames change.
- [ ] 5.5 Implement logical horizontal navigation and engine-geometry vertical, Home/End, and page navigation with retained visual advance and bidi/affinity tests.
- [ ] 5.6 Implement declared behavior for editable text, read-only/selectable text, atomic objects, controls, annotations, page background, margins, and inter-page gaps.
- [ ] 5.7 Resolve frame-bound pointer targets through edit-surviving anchors against current canonical state and return typed stale/invalid outcomes rather than stale numeric-offset mutations.
- [ ] 5.8 Add collaboration tests for local pointer/keyboard interaction interleaved with remote insert, delete, split, move, repagination, and selection-anchor invalidation.

## 6. One-surface React and Vue composition

- [ ] 6.1 Add the shared page, semantic/accessibility, selection/caret/composition overlay, and input-host CSS/paint primitives to the single-source core stylesheet.
- [ ] 6.2 Wire React host coordinates, focus, pointer capture, keyboard/native input, scroll, zoom, and frame lifecycle to the shared controller using only public contracts.
- [ ] 6.3 Implement the equivalent Vue composition and prove adapter CSS remains import-only and behaviorally paired.
- [ ] 6.4 Render caret and selection overlays from interaction-frame geometry with correct clipping, transforms, writing direction, zoom, pointer transparency, and explicit handle/control exceptions.
- [ ] 6.5 Add public-package React and Vue browser scenarios for click-to-caret, type, range selection, formatting, clipboard, IME, undo/redo, repaint, save, and reopen on body paragraphs.
- [ ] 6.6 Make split edit/preview explicitly diagnostic, label it as non-conformance UI, and remove it from normal editor/demo startup after the paired one-surface baseline passes.

## 7. Asynchronous layout, repaint, and failure handling

- [ ] 7.1 Thread dirty semantic identities and dependency fingerprints from `ModelChange` into incremental layout scheduling without putting layout on the synchronous store transaction path.
- [ ] 7.2 Add cancellable scheduled layout/paint work that prioritizes the active/visible page window and prevents superseded revisions from publishing.
- [ ] 7.3 Publish a replacement interaction frame only after its visible display, semantic index, caret, and selection geometry are complete for the declared window.
- [ ] 7.4 Keep the last coherent frame visible during pending work and safely rebase or reject pointer input received against it.
- [ ] 7.5 Retain committed canonical state and the last coherent frame on layout/paint failure, and emit bounded typed diagnostics without retry storms.
- [ ] 7.6 Instrument input handling, validation/publication, scheduling delay, active-window layout, frame publication, downstream convergence, cancellation, and stale-interaction outcomes.
- [ ] 7.7 Add fake-scheduler tests for rapid typing, remote bursts, configuration/resource changes, cancellation races, failed layout, and older-frame publication attempts.

## 8. Page virtualization, scroll, and large-document gate

- [ ] 8.1 Add viewport and overscan inputs plus an engine-owned mounted-page-window result that includes exact placeholders for unmounted pages.
- [ ] 8.2 Keep the caret/composition page, pointer-captured destination, focused interaction, accessibility focus, and required visible selection pages mounted or materialized before interaction completes.
- [ ] 8.3 Preserve complete semantic selections across unmounted pages and reconstruct equivalent visible overlays when pages remount.
- [ ] 8.4 Implement page-identity/content-offset scroll anchoring when earlier page geometry changes, including a typed fallback when the anchor no longer resolves.
- [ ] 8.5 Implement bounded drag-selection autoscroll that requests destination page windows and never derives positions from placeholder DOM.
- [ ] 8.6 Add deterministic virtualization tests for fast scroll, zoom, page-count changes, long selections, remote repagination, active composition, focus movement, and mount/unmount races.
- [ ] 8.7 Run the representative 300–500-page corpus and record mounted display pages, DOM nodes, ProseMirror nodes/DOM, retained memory, input latency, active-frame latency, scroll work, and downstream convergence against ratified budgets.
- [ ] 8.8 Keep the complete hidden ProseMirror projection if the gate passes; if it fails for measured projection cost, record the evidence and create the bounded mounted-window implementation task without changing canonical or public semantics.
- [ ] 8.9 If a bounded ProseMirror window is required, prove selection, IME, history, clipboard, anchors, collaboration, window movement, and public-driver equivalence before enabling it.
- [ ] 8.10 Pass and record the first `interactive-paginated` acceptance gate for the supported body-paragraph matrix through both public adapters, including direct page input, caret/selection, IME, accessibility, async frame coherence, virtualization, save/reopen, and ratified performance; update only the interaction claim and do not require or infer the feature-WYSIWYG claim.

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

## 10. Accessibility, parity, claims, and final gates

- [ ] 10.1 Complete the single semantic/accessibility projection for every claimed feature lane with reading order, roles, names, editability, selection, current focus, and actions mapped to canonical semantic identities.
- [ ] 10.2 Prove accessibility focus can request virtualized content without identity loss and that pointer, keyboard, and accessibility actions produce equivalent semantic commands.
- [ ] 10.3 Run identical engine-neutral `EditorDriver` interaction suites against installed-style React and Vue packages with no private ProseMirror or engine-module access.
- [ ] 10.4 Verify that every feature-WYSIWYG claim has its own comparator bundle for authored state, resolved style, shaping/layout, display geometry, interaction geometry, semantic/accessibility output, DOCX save/reopen, and relevant PDF/print output.
- [ ] 10.5 Update the feature-support matrix and docs to claim only the exact rendered, read-only, fallback-editable, typed-editable, interactive-paginated, or feature-WYSIWYG matrix proven by evidence.
- [ ] 10.6 Add a guard that fails CI if paginated preview repaint alone is labeled interactive-paginated/WYSIWYG or if diagnostic split mode is used as acceptance evidence.
- [ ] 10.7 Run targeted typecheck, unit/property tests, paired adapter parity, API extraction, i18n validation where strings changed, browser interaction suites, save/reopen fixtures, security checks, and representative performance gates.
- [ ] 10.8 Obtain independent architecture, interaction, accessibility, security, and performance review with no open Blocker/High finding before marking the capability apply-complete.
