## 1. Authority and Baseline

- [x] 1.1 Remove superseded active changes, leave pre-existing archive history untouched, and establish this as the only active change.
- [x] 1.2 Update `CLAUDE.md`, `packages/core/README.md`, and the edit-pipeline script to identify this change as the sole production authority.
- [x] 1.3 Record the non-clean baseline in `baseline.md`, including the commands skipped after `bun test` failed.
- [x] 1.4 Inventory deferred feature lanes in `deferred-features.md` without converting preservation into support claims.

## 2. Canonical Typed OOXML Tree

- [ ] 2.1 Define stable identities and the ordered typed/generic OOXML node union with namespace, attribute, mixed-child, and text invariants.
- [ ] 2.2 Implement bounded OPC/XML loading into the single canonical tree with adversarial limit, path, entity, and external-target tests.
- [ ] 2.3 Implement revision-proven paragraph, story, relationship, and style indexes derived only from the canonical tree.
- [ ] 2.4 Add atomic tree-edit primitives and invariant checks used exclusively by `DocumentStore` transactions.
- [ ] 2.5 Implement escaped normalized OOXML serialization and the repository-owned namespace-aware fingerprint over URI/local-name nodes, ordered significant children/text, and order-insensitive attribute sets.
- [ ] 2.6 Prove supported edits preserve adjacent and nested generic unknown nodes in structural order.
- [x] 2.7 Add fingerprint tests proving prefixes, attribute order, insignificant inter-element whitespace, quote style, and empty-element spelling are ignored while significant child order is not.
- [ ] 2.8 Add the independent save/reopen semantic digest for paragraph identities, content tokens, accepted properties, and generic-node structure; require both serialization oracles to pass.

## 3. Paragraph Semantic Operations

- [ ] 3.1 Define paragraph text, authored whitespace, tab, hard-break, split/join, and the complete D8 run/paragraph property `DocOp`s over stable node identities and UTF-16 positions.
- [ ] 3.2 Implement validation, staging, normalization, atomic publication, and revision-tagged `ModelChange` evidence.
- [ ] 3.3 Add rejection tests proving invalid or stale operations leave tree, revision, indexes, and notifications unchanged.
- [ ] 3.4 Implement one semantic history entry per accepted PM transaction and per toolbar/command invocation, with atomic multi-`DocOp` commit.
- [ ] 3.5 Group all accepted transactions from IME `compositionstart` through `compositionend` into one semantic history entry.
- [ ] 3.6 Prove projection reconciliation creates no history entry and consecutive ordinary typing transactions may remain separate without time-based PM grouping.

## 4. ProseMirror Binding

- [ ] 4.1 Project inline text, authored whitespace, tab, hard break, and the complete accepted run/paragraph property boundary into a minimal ProseMirror schema.
- [ ] 4.2 Map insertion, deletion, split/join, content-token, and every accepted run/paragraph property transaction step into typed `DocOp`s.
- [ ] 4.3 Reject unsupported transactions without canonical effects and reconcile the view to committed state.
- [ ] 4.4 Reconcile `ModelChange`s incrementally with a projection-only origin and loop-prevention tests.
- [ ] 4.5 Add architecture guards preventing ProseMirror types or view access in store, layout, output, and public host contracts.
- [ ] 4.6 Add guards proving save, layout, and semantic history do not read the ProseMirror document or history plugin.

## 5. Semantic Paragraph Layout and Interaction

- [ ] 5.1 Define revision-tagged page, paragraph-fragment, line, and style-span records with stable source ranges.
- [ ] 5.2 Resolve font family, half-point size, color, bold, italic, underline variant/color, strike/double-strike, highlight, vertical alignment/baseline, caps/small-caps, character spacing, horizontal scaling, and kerning into style spans and line measurement.
- [ ] 5.3 Resolve paragraph style, alignment, spacing, line spacing/rule, left/right/first-line/hanging indents, tabs, numbering identity/level, keep-next, keep-lines, widow control, page-break-before, and shading into paragraph fragments and pagination.
- [ ] 5.4 Publish stale-safe layout revisions and retained invalidation for paragraph edits and style changes.
- [ ] 5.5 Derive semantic caret stops, hit regions, selections, keyboard navigation, and composition anchors from layout records.
- [ ] 5.6 Render native paragraph DOM safely as a non-authoritative consumer without remeasurement or geometry derivation.
- [ ] 5.7 Add dependency guards keeping canonical model input and semantic layout authority separate from DOM output.

## 6. Private React Acceptance

- [ ] 6.1 Build a private React harness around the engine-owned paragraph surface without changing public support manifests.
- [ ] 6.2 Add a fixture covering known/unknown ordered OOXML, every D8 run/paragraph property, inline text, authored whitespace, tab, hard break, edits, and cross-page fragments.
- [ ] 6.3 Prove load, edit, format, semantic caret/selection, normalized save, namespace-aware fingerprint, semantic digest, and reopen through the private harness.
- [ ] 6.4 Record browser evidence and keep the slice private until all paired gates pass.

## 7. React and Vue Production Parity

- [ ] 7.1 Integrate the accepted engine surface through thin React and Vue lifecycle hosts.
- [ ] 7.2 Add paired semantic edit, layout, interaction, save/reopen, focus, and teardown tests.
- [ ] 7.3 Pass export, editor-contract, docs-surface, parity-contract, feature-parity, and adapter-CSS checks.
- [ ] 7.4 Pass API snapshot and i18n validation and update public support claims only after paired acceptance.

## 8. Verification and Completion

- [ ] 8.1 Run focused canonical-tree, store, binding, layout, interaction, serializer, and adapter test suites.
- [ ] 8.2 Run `bun run typecheck` and compare `bun test` with the recorded non-clean baseline without hiding infrastructure failures.
- [ ] 8.3 Resolve duplicate Playwright loading and duplicate Happy DOM registration before claiming a clean production gate.
- [ ] 8.4 Reconcile or replace archived-spike disposability and retired-migration guards so archive moves remain intentional.
- [ ] 8.5 Run parity, API, and i18n checks independently even when the aggregate test command fails.
- [ ] 8.6 Run `openspec validate typed-ooxml-paragraph-editor --strict` and confirm this remains the only active change.
