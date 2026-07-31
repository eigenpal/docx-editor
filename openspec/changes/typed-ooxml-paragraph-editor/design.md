## Context

The repository already contains production packages for canonical storage, ProseMirror binding, semantic layout, output, and interaction, but their direction had been obscured by overlapping proposals. Those superseded active proposals have been removed. This change is the sole active production authority; pre-existing archive history remains untouched and is not task-sequencing authority.

The implementation starts from an imperfect baseline: `bun run typecheck` passes, while `bun test` reports 2210 passing tests, 7 failures, and 2 errors. The failures are confined to archived-spike disposability/retired-migration guards, duplicate Playwright loading, and duplicate Happy DOM registration. Because the test command failed, the previously chained parity, API, and i18n checks did not run. See `baseline.md`.

## Target Pipeline

The complete production path is model-canonical and revision-scoped:

```text
LOAD
bounded OPC/ZIP + namespace-aware XML parse
  -> typed + generic ordered OOXML part trees
  -> DocumentStore(revision)
  -> revision-proven semantic indexes
  -> initial clean semantic layout

EDIT
browser input / native selection / IME / keymap
  -> ProseMirror transaction
  -> EditorBinding transaction mapping
  -> typed DocOp batch
  -> DocumentStore validation + atomic tree commit
  -> ModelChange {
       dirty/created/deleted/moved identities,
       split/join effects,
       dependency keys,
       impact: text-local | paragraph-local | flow-structural | global
     }
  -> parallel projections:
       ProseMirror reconciliation
       semantic layout scheduling

LAYOUT
ModelChange + committed tree/index revision + previous complete layout
  -> resolve affected dependency closure
  -> reuse fingerprint-valid paragraph shaping/line caches
  -> choose latest safe flow checkpoint before first affected block
  -> measure -> shape -> line break -> paginate dirty interval
  -> compare complete flow state with previous checkpoints
  -> on exact convergence:
       retain unchanged prefix/suffix Page and DisplayItem identities
     otherwise:
       continue relayout or conservatively restart clean full layout
  -> revision guard + atomic complete-layout publication

OUTPUT + INTERACTION
complete semantic Page/ParagraphFragment/Line/StyleSpan/DisplayItem records
  -> retain fixed page shells and complete scroll geometry
  -> materialize viewport + bounded overscan + caret/selection pages
  -> safe native DOM paint in React/Vue
  -> pointer coordinates -> semantic hit-test records
  -> stable text positions -> caret/selection geometry
  -> interaction intent -> ProseMirror command or typed DocOp

SAVE
committed ordered OOXML tree
  -> escaped normalized serialization of dirty parts
  -> retain untouched OPC entry payloads
  -> bounded package write
  -> reopen -> canonical fingerprint + semantic digest
```

The optimized edit loop does not treat deferred scheduling as incremental work. Dirty evidence originates in the store, paragraph caches require complete input/dependency fingerprints, pagination resumes only from captured semantic flow state, and suffix reuse requires exact convergence. Long global work is cancellable and cooperatively sliced, but only a complete result matching the latest requested store revision may publish. Output virtualization reduces mounted DOM and repaint work without changing semantic layout or making DOM state authoritative.

Performance conformance uses full-vs-incremental differential output, stable-reference assertions, cache hit/miss reasons, layout work counters, publication counters, and mounted-page bounds. It does not use wall-clock thresholds as correctness gates.

## Goals / Non-Goals

**Goals:**

- Establish one canonical, ordered, tree-backed OOXML model for known and unknown content.
- Deliver a complete paragraph load/edit/layout/interact/save/reopen vertical slice.
- Keep ProseMirror, semantic indexes, layout, DOM, and adapter state as projections.
- Define semantic layout and interaction contracts over the canonical tree.
- Gate production support on private React acceptance followed by React/Vue parity.

**Non-Goals:**

- Full WordprocessingML feature coverage in this change.
- Exact byte-for-byte XML round trips; output is normalized OOXML.
- Restoring any archived proposal as active authority.
- Making ProseMirror save/history or DOM-derived geometry authoritative.
- Claiming tables, drawings, page furniture, notes, fields, collaboration, deterministic PDF/print, or server rendering complete.

## Decisions

### D1: One ordered OOXML tree is canonical

Each parsed part owns one ordered tree. Known elements use typed node variants with typed attributes and children. Unsupported elements use generic nodes that retain qualified name, namespace bindings, ordered attributes, ordered mixed children, and text. Typed and generic nodes coexist in the same tree; unknown content is not held in side capsules or a second package model.

Stable node identities are assigned at the model boundary. Paragraph, story, relationship, and style indexes are derived from the tree and carry the source revision. They can be rebuilt and are never serialization or mutation authority.

Alternative rejected: a semantic paragraph model plus raw-XML preservation capsules. Two representations require ownership arbitration and make edits, ordering, and save behavior diverge.

### D2: Semantic operations mutate the tree

`DocumentStore` owns the current tree revision. `DocOp`s address stable semantic identities, validate against derived indexes, and commit tree edits atomically. A commit publishes `ModelChange`; rejected operations publish nothing. Load, layout, queries, save, and adapter projections all consume the committed revision.

Alternative rejected: directly mutating indexes or projection records and later reconciling them into OOXML. Derived state cannot safely reconstruct ordering or unsupported content.

### D3: ProseMirror is an editing projection only

`EditorBinding` projects supported paragraph content into ProseMirror and maps complete transactions, including step mappings and selection evidence, into typed `DocOp`s. It commits the store first and reconciles the view from the resulting `ModelChange`. Projection-origin updates do not map back into semantic operations.

Save never reads ProseMirror. Layout never reads `EditorState`, `EditorView`, or DOM geometry. The old ProseMirror-owned save and history paths are forbidden; undo/redo operates through semantic store operations and committed revisions using the grouping rules in D10.

Alternative rejected: retaining PM history as the real undo authority. It can replay view steps that no longer correspond to canonical tree state after external or normalized edits.

### D4: Define the semantic layout vocabulary

The semantic layout path emits native `Page`, `ParagraphFragment`, `Line`, and `StyleSpan` records with stable semantic source ranges and revision provenance. Paragraph measurement, line breaking, spacing, pagination, and style resolution operate from the committed tree and derived style indexes.

Output consumes the semantic records and performs safe DOM construction without becoming a geometry authority.

### D5: Semantic interaction remains authoritative

Caret stops, hit-test regions, selection ranges, keyboard navigation, and composition anchors are derived from semantic layout records and stable text positions. DOM APIs may deliver pointer/input events and paint the result, but DOM ranges and element rectangles cannot define canonical positions or document geometry.

Alternative rejected: native DOM selection as the model. Virtualization, repaints, bidi text, and cross-fragment paragraphs make DOM identity transient.

### D6: Acceptance proceeds from private React proof to paired adapters

The first end-to-end harness is private to the React development path and proves load, paragraph editing, formatting, pagination, semantic interaction, normalized save, and reopen. It does not add a public support claim. Production completion then requires the same engine-owned behavior through thin React and Vue hosts, paired tests, public contract checks, and adapter CSS constraints.

Alternative rejected: implementing React and Vue simultaneously before the engine slice stabilizes. It multiplies integration churn; the private harness is disposable acceptance infrastructure, not a framework-specific engine.

### D7: Deferred features are explicit inventory

Every unsupported WordprocessingML lane is recorded in tasks with its current parse/model/layout/edit/save status and a named future gate. Generic tree preservation does not imply semantic editing or visual fidelity.

### D8: The first paragraph property boundary is fixed

The private React fixture and paired production acceptance cover:

- run font family, half-point size, color, bold, italic, underline variant and color, strike and double-strike, highlight, vertical alignment/baseline, caps and small-caps, character spacing, horizontal scaling, and kerning;
- paragraph style, alignment, spacing, line spacing and rule, left/right/first-line/hanging indents, tabs, numbering identity and level, keep-next, keep-lines, widow control, page-break-before, and shading;
- inline text, authored whitespace, tab, and hard break content.

Hyperlinks, fields, comments, tracked changes, images, tables, content controls, headers/footers, and footnotes/endnotes are deferred. Generic preservation of those elements does not make them part of paragraph acceptance.

Alternative rejected: an open-ended “common formatting” boundary. It cannot produce deterministic fixtures, typed-node coverage, or reviewable support claims.

### D9: Normalized XML has two repository-owned oracles

The primary oracle is a namespace-aware canonical tree fingerprint. It compares each element by namespace URI and local name, attributes as an order-insensitive set keyed by namespace URI and local name, and ordered significant element/text children. It ignores namespace prefix choice, attribute order, insignificant inter-element whitespace, quote style, and empty-element spelling. The fingerprint implementation and fixtures live in the repository and do not delegate correctness to lexical XML equality.

A save/reopen semantic digest is a mandatory second gate. It compares the supported paragraph identities, text/content tokens, accepted run and paragraph properties, and preserved generic-node structure after reopening the produced package. Passing one oracle cannot compensate for failing the other.

Alternative rejected: byte equality or serializer-string snapshots. Both reject harmless normalization while failing to express semantic loss precisely.

### D10: Semantic history groups accepted user intents

Each accepted user intent creates one semantic history entry:

- one supported ProseMirror transaction maps atomically to one entry;
- one IME composition from `compositionstart` through `compositionend` maps to one entry even when ProseMirror emits multiple transactions;
- one toolbar or command invocation maps to one entry;
- projection reconciliation creates no history entry.

Consecutive ordinary typing transactions may remain separate entries in this slice. Time-based ProseMirror history grouping is not authoritative. Undo and redo apply one semantic entry at a time and then reconcile projections from the committed `ModelChange`.

Alternative rejected: importing ProseMirror's timing and adjacency grouping. It cannot group multi-transaction composition reliably across canonical reconciliation.

### D11: Browser interaction and human feedback come first

The first runnable milestone is the existing React `DocxEditor` hosting a visible ProseMirror `contenteditable` paragraph surface. It proves browser-native click, drag, arrow, Shift-arrow, and select-all selection; text insertion and selected-text replacement; backward and forward deletion across run boundaries; paragraph split and join; and normalized save/reopen through `EditorBinding → DocOp → DocumentStore`.

The checkpoint defines Word-like ProseMirror behavior for Enter, Backspace, Delete, Mod-B/I/U, select-all, list boundaries, and stored marks. Repository-owned behavioral tests specify these commands, and every accepted command commits through the new binding and semantic operations.

This milestone may use page-like styling, but it is not the final paginated renderer and creates no pagination or public-support claim. ProseMirror owns browser interaction only for this temporary visible projection; `DocumentStore` remains canonical and save never reads ProseMirror.

To avoid delaying feedback, the checkpoint may use a temporary `DocumentStore` load/edit/save path. It must not add a dual-write bridge to `OoxmlPart`; typed-tree authority resumes after feedback as the replacement path.

One browser smoke test plus focused store/binding and trust-boundary checks is sufficient for the checkpoint. Broad property matrices, exhaustive edge-case suites, semantic pagination, and paired-adapter conformance follow after the user has exercised the demo. Implementation stops at this checkpoint, asks for hands-on feedback, records blocking interaction findings, and uses that feedback to order the next work.

Alternative rejected: completing the canonical-tree, property, layout, interaction, and parity matrices before exposing any browser interaction. That delays the highest-value evidence: whether paragraph writing, deletion, native selection, and Word-like ProseMirror keymaps feel correct to a user.

### D12: Layout work is change-scoped, resumable, and viewport-bounded

Each committed `ModelChange` carries dirty, created, deleted, moved, split/join, and dependency-key evidence plus an impact class: text-local, paragraph-local, flow-structural, or global. Layout consumes this evidence directly instead of reconstructing invalidation from projection records.

Paragraph shaping and line layout are cached by stable paragraph identity, canonical content fingerprint, resolved property/dependency fingerprint, available width, resource fingerprints, shaping configuration, and producer version. Layout retains its previous complete result and captures revision-tagged flow checkpoints at page boundaries and configurable sparse block intervals. It resumes at the latest safe checkpoint before the first affected block and reuses an unchanged suffix only after the complete flow state converges exactly. Any missing dependency, unsupported position-sensitive feature, stale revision, or unproven state match falls back to clean full layout.

Unchanged `Page` and `DisplayItem` records retain identity across revisions. Output keeps fixed page shells for complete scroll geometry while materializing detailed content only for the viewport, bounded overscan, and any page containing the logical caret or selection. React and Vue consume the same engine-owned visible-page range and do not derive geometry.

Unavoidable global layout runs as cancellable, revision-tagged cooperative work and publishes only one complete matching revision. Worker execution is deferred until font and resource transfer semantics are specified. Conformance compares every incremental result with a clean full layout and asserts bounded layout, publication, and mounted-page work without relying on flaky wall-clock thresholds.

Checkpoint, virtualization, and scheduling contracts are implemented against this repository's canonical store and semantic layout boundaries without adding another runtime or build dependency.

Alternative rejected: treating requestAnimationFrame deferral, post-layout bridge caching, or React memoization as incremental layout. Those can reduce scheduling or paint overhead but still perform full-document layout after every edit.

### D13: Production engine source and publication converge on one core package

All production `packages/engine-*` source moves physically into `packages/core/src/` under enforced internal lanes: `contracts`, `store`, `binding`, `layout`, `output`, `editor`, `sync`, `server`, and `clients`. The repository publishes one engine package, `@docx-editor.dev/core`; React, Vue, Nuxt, agents, and i18n remain separate adapter/product packages.

The physical merge does not create one unrestricted barrel. Intentional subpath exports expose environment-specific entry points such as `.`, `/editor`, `/layout`, `/sync`, and `/server`. The default semantic-core graph remains DOM-free, ProseMirror-free, Yjs-free, transport-neutral, and PDF-free. Lane-specific TypeScript projects, import-graph tests, conditional exports, and bundle-graph checks prevent browser entry points from pulling server code or optional runtime dependencies. React and Vue import the PM-free `/editor` composition boundary.

Migration proceeds lane by lane with temporary compatibility aliases, then removes each `engine-*` workspace package only after its imports, tests, API surface, and runtime graph resolve through `packages/core`. Public API snapshots are updated only for intentional `@docx-editor.dev/core` exports.

Alternative rejected: moving files into one directory while removing dependency-lane enforcement. That would make the semantic store transitively depend on DOM, ProseMirror, Yjs, server transports, or output backends and would erase the architecture rather than simplify its packaging.

## Risks / Trade-offs

- [Normalized serialization changes lexical XML details] → Require both the D9 namespace-aware canonical tree fingerprint and save/reopen semantic digest.
- [Generic nodes can bypass trust controls] → Apply bounded ZIP/XML parsing, safe names/paths/URLs, finite depth/count limits, and escaped serialization at the boundary.
- [Stable identities can drift during normalization] → Define allocator and identity-preservation rules before transaction mapping.
- [PM transaction mapping can be incomplete] → Reject unsupported steps without canonical effects and add step-specific conformance cases.
- [Browser paint can accidentally regain authority] → Enforce package dependency and import guards plus semantic hit-test tests.
- [Incremental layout reuses an invalid suffix] → Require complete checkpoint-state equality, full-layout differential tests, and conservative fallback.
- [Virtualization loses interaction state] → Keep semantic caret/selection state independent of mounted DOM and retain their pages in the materialized window.
- [One physical package collapses environment boundaries] → Preserve lane-specific TypeScript/import/bundle guards and conditional subpath exports.
- [Known baseline failures hide regressions] → Track the exact baseline separately and require no new failures; resolve infrastructure failures before a clean completion claim.

## Migration Plan

1. Freeze this change as the only active OpenSpec authority and update stale documentation references.
2. Implement only the tree, text `DocOp`, binding, and React portions required for the browser-first checkpoint.
3. Run the visible ProseMirror paragraph demo, ask for hands-on feedback, and resolve its blocking writing, deletion, selection, and Word-like keymap findings.
4. Repair the test and gate infrastructure so the recorded baseline is a comparison later work can read rather than re-derive.
5. Continue typed-tree loading, edit primitives, properties, semantic layout, and interaction in vertical order, retiring the byte-range preservation model as the tree becomes authoritative.
6. Pass paginated private React acceptance against a correct layout, then add change-scoped incremental layout and output virtualization differentially against it.
7. Consolidate production `engine-*` lanes physically under `packages/core`, preserving dependency and environment guards, and retire each workspace package as its replacement becomes authoritative.
8. Pass paired React/Vue production gates.
9. Keep unsupported lanes deferred until their own reviewed changes.

Rollback is package-local until public parity acceptance: disable the private harness and retain the last committed canonical store path. Archived proposals remain evidence and are never restored as competing active changes.

## Open Questions

None for the paragraph-slice authority reset. Any expansion of the D8 boundary, D9 oracle semantics, D10 history grouping, D11 browser-first checkpoint, D12 performance boundary, or D13 package boundary requires a reviewed specification change.
