## 1. Evidence and complete hot-path inventory

- [ ] 1.1 Add counters for child-sequence visits, sequence summaries, validation visits, fallback validation, index rebuilds, page visits, page-array copies, checkpoint copies, shell-offset writes, DOM mutations, queue delay, and allocations.
- [ ] 1.2 Inventory every store, binding, layout, output, selection, review, and adapter scan reached by eligible typing.
- [ ] 1.3 Record each aggregate's owner, dependency key, invalidation class, retained size, and current complete-rebuild cost.
- [ ] 1.4 Capture production flame profiles and allocation profiles for isolated, sustained, and 100 Hz burst typing in small and large documents.
- [ ] 1.5 Replace the supplied profiling document with a deterministic synthetic fixture that preserves scale and feature shape without source content or metadata.
- [ ] 1.6 Pin fixture hash, semantic counts, feature inventory, caret positions, paragraph classes, viewport, warmup, run count, browser version, and machine class.
- [ ] 1.7 Fix the benchmark probe to mark model commit and provisional patch separately and verify text, caret, model revision, display revision, and layout revision before recording.
- [ ] 1.8 Make sustained input run without waiting for each presentation and require at least 100 samples for every reported p95.
- [ ] 1.9 Record the complete non-clean functional and performance baseline before architecture changes.

## 2. Revision, input, selection, and barrier protocols

- [ ] 2.1 Define `modelRevision`, `layoutRevision`, `displayRevision`, selection epoch, and input queue sequence in one internal surface-state contract.
- [ ] 2.2 Classify every snapshot field as model-derived, layout-derived, or private display state and preserve compatible public `revision` semantics.
- [ ] 2.3 Publish committed model revision, `ModelChange`, mapped model selection, and selection epoch as one atomic surface transition.
- [ ] 2.4 Tag installed DOM selection with its epoch and reject delayed native selection evidence from older epochs.
- [ ] 2.5 Define one accepted `beforeinput` event as one semantic intent and history entry while permitting only presentation and settle coalescing.
- [ ] 2.6 Define undo, redo, external store edits, and automation edits during provisional state.
- [ ] 2.7 Define save linearization through one captured input queue sequence, including reentrant save and later input exclusion.
- [ ] 2.8 Create a method-by-method barrier matrix for pointer, keyboard, table, object, review, automation, print, screenshot, export, zoom, resize, scope switching, structural commands, composition, and teardown.
- [ ] 2.9 Assign each barrier operation to queued replay, synchronous settle, existing typed unavailability, or canonical-only execution.
- [ ] 2.10 Define barrier tokens, mutation queuing, revision rechecks, re-hit-testing, cancellation, timeout, and teardown behavior.
- [ ] 2.11 Define the private IME composition draft lifecycle, single commit, cancellation, blur, detach, failure, save refusal, and geometry refusal.
- [ ] 2.12 Pin public ordering for store commit, display transition, snapshot replacement, `change`, `selectionChange`, and reentrant mutations.
- [ ] 2.13 Specify concurrent and reentrant save promise sharing plus typed `composition-active` rejection.
- [ ] 2.14 Add model-level protocol tests before introducing provisional DOM.

## 3. Sealed mutation lineage and validation

- [ ] 3.1 Encapsulate scoped tree construction behind sanctioned store mutation primitives.
- [ ] 3.2 Define flat-array `TreeMutationProof` witnesses for rebuilt ancestry, exact splice windows, identity effects, namespace scope, package-shell effects, and dependency invalidations.
- [ ] 3.3 Reject arbitrary replacement roots and require complete validation when flat-array ancestry cannot prove local invariants.
- [ ] 3.4 Validate changed subtrees and rebuilt ancestors' local invariants without treating ancestor validation as a descendant-wide scan.
- [ ] 3.5 Patch duplicate identity and parent checks from the prior validated index without a body-width sibling map.
- [ ] 3.6 Escalate missing lineage, namespace changes, and unsupported operations to complete validation.
- [ ] 3.7 Skip package invariant scans only for package-shell-identical text replacement.
- [ ] 3.8 Prove flat-array scoped validation against complete validation with valid edits, forged proof, invalid XML, duplicate identities, namespace changes, and unsafe package changes.
- [ ] 3.9 Gate sequence prototyping on zero mismatches across deterministic and randomized validation sequences.

## 4. Public child contract and sequence selection

- [ ] 4.1 Pin `OoxmlNode.children` as a stable frozen `readonly OoxmlNode[]` projection with true `Array.isArray` behavior.
- [ ] 4.2 Define one authoritative internal child sequence and forbid public projection use by mutation, validation, serialization, and hot internal traversal.
- [ ] 4.3 Define non-security sequence summaries and exact local path-lineage witnesses for every candidate representation.
- [ ] 4.4 Prototype persistent vector, chunked rope, and immutable overlay through complete transaction, layout traversal, save, undo, and memory workloads.
- [ ] 4.5 Test ordered iteration, indexed edits, structural sharing, immutable old revisions, generic fidelity, deterministic serialization, and public projection identity.
- [ ] 4.6 Test API extraction, package consumers, array methods, enumeration, frozen behavior, and repeated public reads.
- [ ] 4.7 Compare end-to-end transaction time, sequence nodes, materialized arrays, temporary bytes, save time, and retained heap.
- [ ] 4.8 Select one representation from measured evidence and record chunking, lineage, projection, and rejection decisions in `design.md`.
- [ ] 4.9 Stop and propose an explicit major API change if no representation preserves the pinned public contract.
- [ ] 4.10 Add property-based and randomized sequence differential tests against a flat-array oracle.

## 5. Canonical sequence migration

- [ ] 5.1 Introduce internal sequence traversal, lookup, replace, insert, remove, split, join, cumulative-size, and projection helpers.
- [ ] 5.2 Migrate `w:body` canonical construction and text-local replacement behind a private rollout flag.
- [ ] 5.3 Add exact sequence-node lineage checks and summary validation before enabling scoped sequence validation.
- [ ] 5.4 Differentially compare sequence-scoped and complete validation, including undeclared sibling replacement and inconsistent summaries.
- [ ] 5.5 Migrate node indexing, serialization, semantic digest, layout story traversal, and binding reads away from hot public projection materialization.
- [ ] 5.6 Keep low-fanout nodes on flat storage unless measured evidence supports migration.
- [ ] 5.7 Preserve namespace behavior, unknown elements, source order, unaffected identity, undo, redo, save, reopen, and D9 oracles.
- [ ] 5.8 Add a warm middle-body insertion gate with zero wide projection materialization and no body-width slot copying.

## 6. Normalized ModelChange and measured sidecars

- [ ] 6.1 Extend `ModelChange` with part-scoped created, deleted, moved, changed, replaced-ancestry, package-shell, dependency, and impact effects.
- [ ] 6.2 Keep private validation proof inside the store and produce `LayoutChangeSet` from actual layout output.
- [ ] 6.3 Introduce immutable-tree-owned sidecars with monotonic publication retagging and bounded weak or history ownership.
- [ ] 6.4 Patch node, parent, paragraph identity, paragraph order, and story-block indexes only where section 1 proves typing-path cost.
- [ ] 6.5 Add content-control, review, note, field, bookmark, drawing, section, or table sidecars one at a time behind separate measured gates.
- [ ] 6.6 Keep complete rebuilding for cold and uncommon indexes.
- [ ] 6.7 Restore or reuse correct tree sidecars during undo and redo without reusing old publication provenance.
- [ ] 6.8 Release revision-only metadata when history entries expire.
- [ ] 6.9 Differentially compare every incremental sidecar with complete rebuilding after edits, split, join, table operations, package edits, undo, redo, and rejection.
- [ ] 6.10 Gate warm typing on zero complete rebuilds for each enabled hot-path sidecar.

## 7. Persistent page and checkpoint directories

- [ ] 7.1 Define layout-owned `InternalLayoutRevision` with model revision, page directory, checkpoint directory, `LayoutChangeSet`, and lazy public projection.
- [ ] 7.2 Preserve `SemanticLayout.pages` as one stable frozen public array projection and forbid that projection on core typing paths.
- [ ] 7.3 Expose read-only page accessors to output and an opaque internal revision handle to editor.
- [ ] 7.4 Define persistent page and checkpoint directory contracts for indexed access, range replacement, cumulative offsets, and structural sharing.
- [ ] 7.5 Migrate incremental layout checkpoints and page publication behind a private rollout flag.
- [ ] 7.6 Define `LayoutChangeSet` for changed, created, deleted, remapped, reused, and materialized pages plus dependency changes.
- [ ] 7.7 Move page shells to normal document flow with explicit dimensions and semantic offsets from the page directory.
- [ ] 7.8 Patch paragraph-page, table geometry, note reserve, drawing-use, revision-slot, field, and review indexes from actual changed intervals.
- [ ] 7.9 Remove unconditional page maps, checkpoint-tail copies, reused-page scans, and page-array copies from converged text-local settle.
- [ ] 7.10 Gate converged settle on changed intervals plus logarithmic directory work.
- [ ] 7.11 Compare page order, shell flow, page records, checkpoint state, cumulative offsets, and every patched layout index with clean full layout.

## 8. Page-local authoritative paint

- [ ] 8.1 Make settled output consume `LayoutChangeSet` and preserve unchanged page shells, materialized DOM, and source maps by identity.
- [ ] 8.2 Dependency-key drawing resources, revision slots, note furniture, field display, and review geometry.
- [ ] 8.3 Remove complete-page maps and shell loops from converged settled paint.
- [ ] 8.4 Scope selection and caret synchronization to changed fragments while retaining semantic authority.
- [ ] 8.5 Add incremental-versus-clean paint-plan tests for page creation, deletion, remap, resource changes, and stale materialized DOM.
- [ ] 8.6 Gate middle-page settle on zero unrelated materialized mutations and zero complete shell-offset rewrites.

## 9. Immutable cooperative layout jobs

- [ ] 9.1 Bind each job to an immutable package snapshot, model revision, scope, and resource fingerprints.
- [ ] 9.2 Refactor preparation, placement, convergence, page finalization, and dependency patching into DOM-free resumable iterators.
- [ ] 9.3 Add deadline checks inside long loops instead of only between phases.
- [ ] 9.4 Inject clock, deadline, continuation scheduler, cancellation owner, and visibility state from the editor lane; use `isInputPending` only as a hint.
- [ ] 9.5 Use timer continuations in hidden tabs and a deterministic clock and continuation queue in tests.
- [ ] 9.6 Meet 4 ms p95 and 8 ms maximum reference slices; split or exclude any slower non-yielding leaf.
- [ ] 9.7 Grant at least one settle slice per 50 ms during sustained input.
- [ ] 9.8 Keep accumulators private until latest-revision publication.
- [ ] 9.9 Fingerprint every shared cache write independently of job liveness.
- [ ] 9.10 Cancel timers, tasks, animation frames, resource callbacks, temporary sequences, and builders in `finally`.
- [ ] 9.11 Cover newer input, detach, reload, font changes, display-mode changes, zoom, and viewport width changes.
- [ ] 9.12 Add deterministic fairness, hidden-tab, starvation, cancellation, stale-discard, immutable-input, and latest-only publication tests.

## 10. Provisional candidate records

- [ ] 10.1 Define private `CandidateChange` and record contracts with predecessor revision, paragraph identity and fingerprint, normalized effects, source layout revision, resource fingerprints, source ranges, lines, styles, caret geometry, and ownership evidence.
- [ ] 10.2 Shape the candidate against exact prior width, style cascade, list, font, HarfBuzz, revision display, and resource fingerprints before commit.
- [ ] 10.3 Compare candidate shaping with a clean candidate oracle and require only fragment, page, line-break, vertical, and flow geometry to remain unchanged from prior complete layout.
- [ ] 10.4 Add fail-closed refusal codes for composition, changed shaping, review wrappers, controls, fields, notes, drawings, tables, breaks, resources, and geometry.
- [ ] 10.5 Commit `CandidateChange` through compare-and-swap across predecessor, paragraph, source layout, normalized effects, and resources.
- [ ] 10.6 Verify committed `ModelChange` and paragraph fingerprint exactly match the candidate before output installation.
- [ ] 10.7 Test reentrant measurers, stale predecessors, resource changes, Latin, ligatures, style boundaries, combining marks, ZWJ, emoji flags, bidi controls, wrapping, and fallback fonts.
- [ ] 10.8 Prove accepted candidate records equal clean full paragraph records.

## 11. Atomic staged-presentation state

- [ ] 11.1 Add private model, layout, display, selection-epoch, input-sequence, and provisional state to `PaginatedSurface`.
- [ ] 11.2 Commit every accepted `beforeinput` intent separately with mapped selection before provisional presentation.
- [ ] 11.3 Patch only the owned paragraph DOM and tag it with model, display, layout, and selection provenance.
- [ ] 11.4 Place the caret from candidate geometry and preserve native-caret fail-soft behavior.
- [ ] 11.5 Chain later insertion from committed selection and candidate source maps without reading stale DOM.
- [ ] 11.6 Coalesce only candidate shaping, provisional paint, and complete settle work.
- [ ] 11.7 Complete synchronous authoritative presentation or freeze editing if provisional installation fails after commit.
- [ ] 11.8 Atomically adopt or replace provisional DOM during latest complete paint.
- [ ] 11.9 Cancel or regenerate provisional state for undo, redo, external edits, automation edits, detach, reload, and remount.
- [ ] 11.10 Suspend editing synchronously on external commits until display catches the external model revision.
- [ ] 11.11 Queue public `change` then `selectionChange` only after snapshot and display transition complete.
- [ ] 11.12 Queue reentrant editor mutations after the current surface transition.
- [ ] 11.13 Add race tests for rejection, stale selection epochs, reentrant handlers, external commits, rapid input, install failure, undo, detach, and stale jobs.

## 12. Barriers, composition, review, accessibility, and hosts

- [ ] 12.1 Implement the approved barrier matrix with revision tokens, mutation queuing, re-hit-testing, and final token checks.
- [ ] 12.2 Implement input-sequence save linearization without reading provisional or composition DOM.
- [ ] 12.3 Implement private composition drafts with one `compositionend` commit and full cancellation cleanup.
- [ ] 12.4 Restore complete latest-revision editable DOM before composition or cancel composition without stale DOM readback.
- [ ] 12.5 Freeze review activation, rail geometry, table context, object controls, and layout-derived chrome while layout is stale.
- [ ] 12.6 Disable stale geometry actions until complete latest-revision publication.
- [ ] 12.7 Preserve one accessible text copy, editor focus, control availability, and assistive-technology selection barriers.
- [ ] 12.8 Preserve reference-stable complete page snapshots while model-only selectors observe committed state.
- [ ] 12.9 Verify React, Vue, Pro review, and editor API packages use the core state machine without adapter-owned fast paths.
- [ ] 12.10 Add browser tests for pointer, arrows, tables, objects, review cards, automation, print, screenshot, export, zoom, resize, save, composition, accessibility, and teardown races.

## 13. Correctness, performance, and memory acceptance

- [ ] 13.1 Add at least 100 isolated attempts across paragraph lengths, caret positions, style boundaries, scripts, and line-edge positions.
- [ ] 13.2 Add at least 180 unpaced sustained characters and 100 Hz burst tests for exact order, per-intent history, selection epochs, final caret, save, and reopen.
- [ ] 13.3 Report every attempted fast path, including eligibility decision time and refusal reason.
- [ ] 13.4 Add a private benchmark event stream keyed by input sequence; never use public `change` as the presentation marker.
- [ ] 13.5 Verify expected text, caret, model revision, display revision, and layout revision before recording presentation.
- [ ] 13.6 Pin the ordinary-typing corpus hash before measuring its eligibility rate.
- [ ] 13.7 Meet 16.7 ms median and 33.4 ms p95 eligible presentation on the maintained reference profile.
- [ ] 13.8 Achieve at least 80% eligibility on the pinned ordinary-typing corpus.
- [ ] 13.9 Keep ineligible p95 within 10% of its recorded synchronous baseline.
- [ ] 13.10 Add large-document incremental-versus-full canonical, layout, paint, selection, review, save, reopen, and security oracles.
- [ ] 13.11 Reach quiescence, force baseline collection, execute 1,000 edits beyond history capacity, reach quiescence, then measure three forced collection cycles.
- [ ] 13.12 Keep retained growth below the greater of 32 MiB or 10% of opened-document baseline heap.
- [ ] 13.13 Prove cancelled jobs release callbacks, buffers, accumulators, sequences, and builders without stale cache writes.
- [ ] 13.14 Keep shared-runner absolute timing informational while enforcing structural and correctness gates.

## 14. Rollout and repository gates

- [ ] 14.1 Place validation lineage, child sequence, sidecars, page directories, local paint, scheduler, and staged presentation behind independent private flags.
- [ ] 14.2 Enable each flag only after its differential, security, memory, API compatibility, and structural work gates pass.
- [ ] 14.3 Enable staged presentation by default only after 80% eligibility, zero correctness events, and all reference budgets pass.
- [ ] 14.4 Update benchmark documentation with the reference machine, browser, metrics, markers, corpus, refusal reporting, and baseline rules.
- [ ] 14.5 Add a consumer-facing changeset after staged presentation becomes default without claiming support for optimized deferred features.
- [ ] 14.6 Run focused store, layout, output, surface, adapter, browser, serial DOM-leak, benchmark, and strict OpenSpec checks.
- [ ] 14.7 Run `bun run format`, `bun run typecheck`, `bun run lint`, `bun run test`, `bun run check:parity`, `bun run api:check`, and `bun run i18n:validate`.
- [ ] 14.8 Compare every result with the recorded non-clean baseline and separate pre-existing failures from regressions.
- [ ] 14.9 Remove rollout flags only after one release cycle without correctness fallback events and with tested rollback paths.
