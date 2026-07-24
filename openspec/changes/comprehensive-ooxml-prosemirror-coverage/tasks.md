## 1. Freeze the corpus and coverage vocabulary

- [ ] 1.1 Freeze the comprehensive fixture bytes, package-member hashes, relationship graph, content types, namespace declarations, and safe resource-limit metadata in a versioned evidence record.
- [ ] 1.2 Generate a QName-plus-parent-context inventory for every XML part in the fixture, distinguishing Transitional namespace families from the Strict reference schemas.
- [ ] 1.3 Record fixture feature regions and counts for paragraphs/runs, styles, numbering, tables, SDTs, sections, related stories, notes, drawings, links, bookmarks, fields, comments, breaks, tabs, symbols, settings, and properties.
- [ ] 1.4 Record fixture defects as inert preservation expectations: body-level `w:pBdr`, duplicate/missing styles, malformed simple fields, repeated drawing IDs, and non-threaded nested comments.
- [ ] 1.5 Record fixture absences and prevent false claims for themes, tracked revisions, charts, diagrams, macros, OLE, remote images, and threaded-comment metadata.
- [ ] 1.6 Add focused-fixture references for every comprehensive-fixture feature so failures identify a minimal diagnostic input.

## 2. Build the formal OOXML support manifest

- [ ] 2.1 Generate and check in the versioned ECMA-376 XSD QName/type/context inventory from `reference/ecma-376/part1/schemas`.
- [ ] 2.2 Add a reviewed Strict-to-Transitional namespace-family mapping and tests rejecting implicit or ambiguous namespace equivalence.
- [ ] 2.3 Define `OoxmlSupportClaim`, `SupportState`, context selectors, capability IDs, evidence IDs, comparator IDs, and source-schema versions.
- [ ] 2.4 Add manifest validation for known QNames, legal contexts, unique ownership, replacement/version rules, and stage-specific evidence.
- [ ] 2.5 Add stage consistency checks preventing editable claims without model, preservation, semantic-operation, binding, serialization, and reopen evidence.
- [ ] 2.6 Generate separate parse, model, preserve, render, PM-project, edit, serialize, and reopen coverage reports for XSD inventory and encountered fixture contexts.
- [ ] 2.7 Map granular support claims to `docs/site/data/word-features.ts` IDs without publishing one aggregate OOXML compatibility percentage.
- [ ] 2.8 Add CI drift checks for XSD inventory, fixture inventory, manifest claims, evidence files, and user-facing feature claims.

## 3. Freeze registered feature-lane contracts

- [x] 3.1 Define stable block, inline, property/resolution, story, and package-resource capability contracts in engine-core.
- [x] 3.2 Add core registration for parse, scan/count, identity traversal, normalization, validation, preservation ownership, serialization, semantic operations, dependency keys, and edit policy.
- [x] 3.3 Migrate paragraph, table, and block-SDT core behavior from central switches into registered capabilities without changing model or serialized output.
- [x] 3.4 Add engine-binding registration for PM node/mark specs, canonical projection, read-only projection, step mapping, reverse reconciliation, selection, clipboard, and IME hooks.
- [x] 3.5 Migrate paragraph and generic read-only block projection into binding capabilities with behavior-equivalent tests.
- [ ] 3.6 Add engine-layout registration for resolution dependencies, measurement, pagination, semantic roles, hit ownership, and display emission.
- [x] 3.7 Migrate paragraph, table, and transparent-SDT layout through the layout registry without changing fingerprints.
- [x] 3.8 Add engine-output registration or exhaustive common handling for every display-item kind used by DOM, PDF, accessibility, print, and hit testing.
- [x] 3.9 Extend registry diagnostics to reject duplicate ownership, missing editable lanes, incompatible versions, cycles, and undeclared runtime ports before document publication.
- [x] 3.10 Fix preservation baseline hashing so deterministic normalization cannot make an untouched block appear edited.
- [ ] 3.11 Add a template and generator for a new feature lane including manifest claim, capability registrations, focused fixture, comparators, and paired adapter scenario.

## 4. Promote one production editor composition

- [x] 4.1 Move framework-independent session ownership from `examples/shared/docxEditorSession.ts` behind the production `Editor` implementation.
- [x] 4.2 Move ProseMirror mounting, canonical commit, rejection snap-back, paginated repaint, save, and disposal from `examples/shared/mountDocxEditor.ts` behind `Editor` plus `EditorHost`.
- [x] 4.3 Replace contract-only throwing `createEditor` with the production composition without leaking PM types or view access.
- [ ] 4.4 Wire `packages/react` to the production `Editor` using host getters, scheduling, post-commit notification, and common display output.
- [ ] 4.5 Wire `packages/vue` to the same production `Editor` and prove prop, event, lifecycle, and imperative-handle parity.
- [x] 4.6 Unify the display paint path so React and Vue consume every common display-item kind without deriving geometry.
- [ ] 4.7 Publish one engine-neutral `EditorDriver` covering load, editability, command, query, selection, display snapshot, save, reopen, and dispose.
- [ ] 4.8 Migrate paired browser smoke tests from the temporary window driver to the stable driver while retaining identical scenarios for React and Vue.
- [ ] 4.9 Add structured read-only diagnostics naming the blocking capability, QName/context, story, and missing pipeline lane.
- [ ] 4.10 Retire the example-only edit mount, duplicate preview composition, contract stub path, and PM-facing E2E hooks after public adapter tests pass.

## 5. Render and edit paragraphs, runs, styles, and lists

- [ ] 5.1 Extend canonical run and paragraph records for authored fonts, size, color, underline, strike, double-strike, baseline, caps, small caps, highlight, shading, language, direction, alignment, indentation, spacing, tabs, breaks, symbols, and no-break characters.
- [ ] 5.2 Parse and preserve every corresponding fixture property with lexical distinctions, omissions, explicit false values, whitespace, and unknown siblings.
- [ ] 5.3 Complete document defaults, paragraph/character/table style records, inheritance, direct-format precedence, and deterministic duplicate/missing-style resolution.
- [ ] 5.4 Complete abstract numbering, levels, formats, label text, indentation, overrides, nested levels, and restart semantics.
- [ ] 5.5 Feed resolved style, numbering, font, bidi, line-break, tab, and mark inputs into shaping and layout without materializing resolved values into authored state.
- [ ] 5.6 Render fixture headings, lists, paragraph spacing/indentation, Unicode/RTL/CJK text, marks, tabs/leaders, breaks, symbols, shading, and equations to display and semantic-tree oracles.
- [ ] 5.7 Add PM nodes/marks/attrs for declared editable paragraph and run properties while retaining semantic IDs and unowned inline capsules.
- [ ] 5.8 Implement semantic text-range, mark, paragraph-property, style, list-level, indent/outdent, restart, tab, break, and symbol operations with runtime validation.
- [ ] 5.9 Map PM text, mark, style, list, split, join, paste, and formatting transactions to minimal operations in one canonical commit.
- [ ] 5.10 Incrementally reconcile normalized paragraph/run changes while preserving text selection, stored marks, plugin state, and typing attributes.
- [ ] 5.11 Serialize edited rich paragraphs by reinserting unowned inline content and reopen to authored-state plus unaffected-XML equivalence.
- [ ] 5.12 Add comprehensive-fixture edits for representative text, formatting, heading, list, tab, break, and symbol regions in both adapters.

## 6. Render and edit tables and structured document controls

- [ ] 6.1 Complete table layout for authored grid widths, grid spans, vertical merges, nested tables, row splitting, repeated headers, borders, margins, shading, floating positioning, and page fragments.
- [ ] 6.2 Parse SDTs nested in table cells and inline/run contexts as first-class canonical structures without flattening.
- [ ] 6.3 Complete SDT canonical properties for text, rich text, checkbox, dropdown, combo box, date, TOC, placeholders, locks, tags, aliases, list items, date formats, and unknown payload.
- [ ] 6.4 Emit typed read-only PM table and SDT nodes/node views that display canonical/rendered content and reject structural disturbance.
- [ ] 6.5 Implement canonical cell-content, row/column insert/delete, merge/split, resize, border, shading, alignment, header-row, and floating-table operations.
- [ ] 6.6 Implement canonical SDT content replacement, checkbox toggle, list selection/item edit, combo text, date, property, and lock-aware operations.
- [ ] 6.7 Add table and SDT PM schemas, transaction mapping, cell/control selections, clipboard rules, and incremental reverse reconciliation.
- [ ] 6.8 Serialize edited tables and SDTs with stable identities, unknown-property reinsertion, package-part diffs, and reopen equivalence.
- [ ] 6.9 Add comprehensive-fixture paired tests for nested/merged/repeated-header/floating tables and every encoded SDT control type.

## 7. Render and edit sections, columns, related stories, and notes

- [ ] 7.1 Model section boundaries, break type, page size, orientation, margins, columns, gaps, separators, and header/footer references.
- [ ] 7.2 Model header, footer, footnote, endnote, and text-box stories with stable identities and reference ownership.
- [ ] 7.3 Paginate portrait/landscape transitions, next-page sections, two-column flow, column breaks, header/footer regions, footnote placement, and endnote flow.
- [ ] 7.4 Render PAGE and NUMPAGES through the page-dependent field resolver while retaining authored instructions separately.
- [ ] 7.5 Add PM projections and scope switching for body, headers, footers, footnotes, endnotes, and frames without exposing multiple canonical models.
- [ ] 7.6 Implement section/page/column/break, header/footer-reference, related-story text, and note/reference semantic operations.
- [ ] 7.7 Map related-story and section editing through scoped PM views with selection restoration and canonical reconciliation.
- [ ] 7.8 Serialize section, relationship, header/footer, and note edits atomically and reopen with stable story/reference identities.
- [ ] 7.9 Add comprehensive-fixture paired tests for all five sections, landscape geometry, two columns, four header/footer pairs, three footnotes, and two endnotes.

## 8. Render and edit drawings, relationships, links, and navigation

- [ ] 8.1 Model embedded media resources and inline/anchored drawing records with relationships, extents, transforms, crop, wrap, position, alt text, and nonvisual metadata.
- [ ] 8.2 Decode only bounded embedded media and render all fixture drawings, including reused image parts and square-wrapped floating geometry.
- [ ] 8.3 Add typed read-only PM image/drawing nodes that retain canonical identity and use common display geometry.
- [ ] 8.4 Implement atomic image insert/replace/delete, resize, crop, inline/anchor conversion, wrap, position, and alt-text operations.
- [ ] 8.5 Serialize drawing and media edits with safe part names, content types, relationship ownership, and no remote fetch.
- [ ] 8.6 Model hyperlinks with separate authored raw and sanitized runtime targets, plus bookmark ranges and internal navigation identities.
- [ ] 8.7 Render external and internal links with explicit activation, semantic roles, and PDF/DOM destinations.
- [ ] 8.8 Add PM hyperlink marks and bookmark boundaries with safe text/target/create/rename/delete operations and anchor repair.
- [ ] 8.9 Add comprehensive-fixture paired tests for eleven drawings, four reused PNGs, two external links, three internal links, and twenty-two bookmarks.

## 9. Render and edit fields, comments, revisions, settings, and properties

- [ ] 9.1 Model field instructions separately from cached/resolved display results and classify executable or external-resolution field families as inert.
- [ ] 9.2 Render TOC, PAGE, NUMPAGES, malformed simple fields, and unknown fields without executing arbitrary instructions.
- [ ] 9.3 Add explicit field insert/edit/remove/refresh operations with permission, resource, convergence, and save/reopen rules.
- [ ] 9.4 Model comment records, range anchors, references, authorship, dates, status, and thread metadata only when structurally encoded.
- [ ] 9.5 Render comment ranges, indicators, navigation, and semantic annotations without fabricating a thread for the fixture's nested independent comment.
- [ ] 9.6 Add PM comment boundaries and semantic create/edit/delete/move/resolve operations with selection and deletion-policy conformance.
- [ ] 9.7 Add focused tracked-insert/delete/move/property-change fixtures, canonical revision records, inert rendering modes, and accept/reject operations before claiming revision support.
- [ ] 9.8 Model and safely edit settings plus core, extended, and custom properties independently from body content.
- [ ] 9.9 Preserve empty property parts, compatibility settings, font-table state, absent theme state, and all fixture source defects on unrelated edits.
- [ ] 9.10 Add paired comprehensive-fixture tests for fields, four independent comments, metadata, settings, malformed fields, and absent-feature claims.

## 10. Complete binding correctness and large-document behavior

- [ ] 10.1 Replace whole-document forward scans with transaction-range mapping and capability-owned affected-range calculation.
- [ ] 10.2 Replace full PM reprojection with incremental reverse steps derived from `ModelChange` evidence or a binding revision index.
- [ ] 10.3 Implement deterministic text, node, table-cell, control, story, and annotation selection preservation with grapheme affinity.
- [ ] 10.4 Integrate the reviewed IME state machine, queued inbound changes, cancellation, and one canonical history group per composition.
- [ ] 10.5 Implement bounded clipboard parsing and feature-aware copy/cut/paste that rejects unsupported cross-boundary structures atomically.
- [ ] 10.6 Decide and implement the measured PM mounting strategy for 300–500-page documents: full-story virtualized DOM or bounded editing window.
- [ ] 10.7 Keep layout and offscreen painting outside the synchronous input path and virtualize pages/display nodes outside the active viewport.
- [ ] 10.8 Instrument PM ranges, mapped steps, DocOps, canonical identities, layout closure, pagination frontier, display items, DOM nodes, allocations, and phase timings.
- [ ] 10.9 Add bounded-edit benchmarks proving no whole-document PM scan, projection, clone, DOM walk, serialization, layout rebuild, or repaint for a bounded local edit.

## 11. Final conformance and migration

- [ ] 11.1 Add headless comprehensive-fixture parse/model/preserve and no-op package-equivalence gates.
- [ ] 11.2 Add deterministic authored, layout, pagination, display, semantic-tree, hit-test, DOM, PDF, and save/reopen evidence for each supported feature region.
- [ ] 11.3 Run the same shared feature scenarios against React and Vue and block a support upgrade when either adapter differs.
- [ ] 11.4 Add malicious variants for archive traversal/bombs, unsafe XML, namespace rebinding, unsafe links, external resources, malformed fields, oversized media, deep nesting, and XML injection.
- [ ] 11.5 Verify every unsupported fixture context is explicitly reported as `readOnly`, `verbatim`, or `unsupported` and cannot be silently flattened, dropped, fetched, or executed.
- [ ] 11.6 Reconcile granular manifest claims with `word-features.ts`, API snapshots, architecture documentation, migration guides, and consumer examples.
- [ ] 11.7 Remove retired demo imports, temporary query-param editor entry, duplicate painters/drivers, source aliases, and contract-only runtime stubs after production adapter conformance passes.
- [ ] 11.8 Run final type, unit, fixture, paired browser, package-export, API, parity, security, deterministic-output, and bounded-performance checks and retain machine-readable evidence.
