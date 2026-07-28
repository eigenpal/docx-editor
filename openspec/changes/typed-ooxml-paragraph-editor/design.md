## Context

The repository already contains production packages for canonical storage, ProseMirror binding, semantic layout, output, and interaction, but their direction had been obscured by overlapping proposals. Those superseded active proposals have been removed. This change is the sole active production authority; pre-existing archive history remains untouched and is not task-sequencing authority.

The implementation starts from an imperfect baseline: `bun run typecheck` passes, while `bun test` reports 2210 passing tests, 7 failures, and 2 errors. The failures are confined to archived-spike disposability/retired-migration guards, duplicate Playwright loading, and duplicate Happy DOM registration. Because the test command failed, the previously chained parity, API, and i18n checks did not run. See `baseline.md`.

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

## Risks / Trade-offs

- [Normalized serialization changes lexical XML details] → Require both the D9 namespace-aware canonical tree fingerprint and save/reopen semantic digest.
- [Generic nodes can bypass trust controls] → Apply bounded ZIP/XML parsing, safe names/paths/URLs, finite depth/count limits, and escaped serialization at the boundary.
- [Stable identities can drift during normalization] → Define allocator and identity-preservation rules before transaction mapping.
- [PM transaction mapping can be incomplete] → Reject unsupported steps without canonical effects and add step-specific conformance cases.
- [Browser paint can accidentally regain authority] → Enforce package dependency and import guards plus semantic hit-test tests.
- [Known baseline failures hide regressions] → Track the exact baseline separately and require no new failures; resolve infrastructure failures before a clean completion claim.

## Migration Plan

1. Freeze this change as the only active OpenSpec authority and update stale documentation references.
2. Introduce the typed/generic tree and adapters behind internal package boundaries.
3. Migrate paragraph parsing, store operations, serialization, layout, and binding in vertical order.
4. Retire superseded paths as each replacement becomes authoritative.
5. Pass private React acceptance, then paired React/Vue production gates.
6. Keep unsupported lanes deferred until their own reviewed changes.

Rollback is package-local until public parity acceptance: disable the private harness and retain the last committed canonical store path. Archived proposals remain evidence and are never restored as competing active changes.

## Open Questions

None for the paragraph-slice authority reset. Any expansion of the D8 boundary, D9 oracle semantics, or D10 history grouping requires a reviewed specification change.
