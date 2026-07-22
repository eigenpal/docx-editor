## Definitions

See `tracked-structural-paragraphs/spec.md` for the shared definitions (active suggesting-mode author, ISO 8601 UTC, semantically equivalent OOXML, revision triple, one PM transaction). They apply here too.

- **Revision** — any of: an `insertion` inline mark, a `deletion` inline mark, a `revision_change` inline mark, or any node-level revision attr defined in this change (`pPrIns`, `pPrDel`, `pPrChange[]`, `paraRPrChange[]`, `sectPrChange`, `trIns`, `trDel`, `trPrChange[]`, `tblPrExChange[]`, `cellMarker`, `tcPrChange[]`, `tblPrChange[]`, `tblGridChange`).
- **Tracked change** — synonymous with revision. The term "tracked change" is preserved for backwards compatibility with existing entry types (`TrackedChangeEntry`); new code prefers "revision."

## ADDED Requirements

### Requirement: Address revisions by id

The system SHALL expose `acceptChangeById(revisionId: number): Command` and `rejectChangeById(revisionId: number): Command`. Both SHALL resolve every revision matching `revisionId` in **either** node attrs or inline marks. When multiple sites in the document share the same revision triple `(id, author, date)` (e.g., a row's `trIns` and each of its cells' `cellMarker: ins`, or paired vertical-merge cells, or `<w:ins>` wrappers split across runs), the command SHALL resolve all such sites in **one PM transaction** (observable as exactly one undo step).

Sidebar grouping and resolution use the full `(id, author, date)` triple, not bare id. Two distinct revisions that happen to share `w:id` across different authors (legal per ECMA-376 since `w:id` is not author-scoped) SHALL NOT be merged.

#### Scenario: Resolve a multi-site revision atomically

- **GIVEN** a row carries `trIns: { revisionId: 1, author: 'Jane', date: '2026-05-28T10:00:00Z' }` and each of its three cells carries `cellMarker: { kind: 'ins', info: { revisionId: 1, author: 'Jane', date: '2026-05-28T10:00:00Z' } }`
- **WHEN** `acceptChangeById(1)` is dispatched
- **THEN** the row's `trIns` and all three cells' `cellMarker` are cleared in one PM transaction (one undo step)

#### Scenario: Unknown revision id is a no-op

- **WHEN** `acceptChangeById(999999)` is dispatched and no node or mark carries that id
- **THEN** no transaction is dispatched and the command returns `false`

#### Scenario: Already-resolved revision id is a no-op

- **GIVEN** revision 1 was previously accepted
- **WHEN** `acceptChangeById(1)` is dispatched again
- **THEN** no transaction is dispatched and the command returns `false`

#### Scenario: Cross-author id collisions remain separate

- **GIVEN** a paragraph carries `pPrIns: { revisionId: 5, author: 'Jane', date: '...' }` and another paragraph carries `pPrIns: { revisionId: 5, author: 'Bob', date: '...' }` (different triples sharing only the numeric id)
- **WHEN** `acceptChangeById(5)` is dispatched
- **THEN** the implementation SHALL resolve only one of the two — the choice is determined by triple discriminator passed by the sidebar entry; if called without an author/date discriminator, the implementation MAY resolve the first encountered and SHALL log a diagnostic warning about the collision

### Requirement: Range-scoped accept and reject

The system SHALL expose `acceptChangesInRange(from: number, to: number): number` and `rejectChangesInRange(from: number, to: number): number`. Both SHALL resolve every revision whose primary site lies within `[from, to]` (PM document positions). Return value SHALL be the count of distinct revision triples resolved.

#### Scenario: Accept all revisions in a paragraph range

- **GIVEN** a document with revisions at positions 100, 200, 300, 400 and the user selects from PM position 150 to 350
- **WHEN** `acceptChangesInRange(150, 350)` is dispatched
- **THEN** the revisions at positions 200 and 300 are accepted; the return value is 2; the revisions at 100 and 400 are unchanged

### Requirement: Accept-all and reject-all cover all revision types

`acceptAll()` SHALL apply per-marker accept semantics to every revision in the document, including inline marks and every node-attr revision type. `rejectAll()` SHALL apply per-marker reject semantics. Resolution order within a single transaction SHALL be deterministic: inline run-level → run-property marks → paragraph-property → paragraph-mark → cell-level → row-level → table-level → section-level. Inner-to-outer ensures structural revisions resolve after the content they contain.

#### Scenario: Accept-all clears mixed revisions and returns triple count

- **GIVEN** a document with one `insertion` mark, one `pPrIns`, one `trIns`, one `cellMarker: ins`, and one `revision_change` mark, with five distinct revision triples
- **WHEN** `acceptAll()` is dispatched
- **THEN** all five revisions are cleared; the return value is 5; one PM transaction is generated

#### Scenario: Reject-all on conflicting structural revisions resolves inner-first

- **GIVEN** a row with `trDel` and cells carrying their own vertical-`cellMarker: { kind: 'merge' }` revisions with different triples
- **WHEN** `rejectAll()` is dispatched
- **THEN** the cell-level merge revisions are cleared first, then the row-level `trDel` is cleared (reject `trDel` ⇒ clear marker); the final document has no revision markers

## MODIFIED Requirements

### Requirement: acceptAll / rejectAll return value definition

`acceptAll()` and `rejectAll()` previously returned the count of tracked-change sites. They now return the count of **distinct revision triples** `(id, author, date)` resolved. Multi-site revisions (row + cells under one triple, vertical-merge pair, etc.) count as one triple, not N sites.

This is a behavior change for callers that depended on the per-site count. Existing inline-only documents are largely unaffected because most inline ins/del revisions have one site per triple; the divergence appears only when structural revisions enter the document.

#### Scenario: Inline-only document acceptAll behavior is unchanged

- **GIVEN** a document with five `insertion` marks each with a distinct revision id (typical pre-structural-changes document)
- **WHEN** `acceptAll()` is dispatched
- **THEN** the return value is 5 (one site per triple, same as the prior site-count behavior)

#### Scenario: Document with structural revisions returns triple count

- **GIVEN** a document with one row insertion comprising `trIns` + three `cellMarker: ins` (four sites, one triple)
- **WHEN** `acceptAll()` is dispatched
- **THEN** the return value is 1 (one triple), not 4 (sites)

## ADDED Requirements

### Requirement: Review sidebar lists every revision in the document

The review sidebar SHALL show one entry per distinct revision triple `(id, author, date)` in the document, grouping multi-site revisions (row+cells, vertical-merge pairs, multi-paragraph commands applied in one operation) into a single entry. Each entry SHALL include:

- Author display name (from `w:author`).
- Date in the user's locale (from the parsed ISO 8601 UTC).
- A human-readable revision-kind label using an i18n key from the `revisions.*` namespace.
- A short context preview where the kind allows it (the affected paragraph text for paragraph-level revisions; the row/column index for table-level revisions; the property name and old→new values for property changes).
- Accept and Reject buttons.

For revisions backed by `CT_TblGridChange` (`tblGridChange`), author and date SHALL be displayed as empty (the underlying OOXML element carries only `w:id`).

The sidebar SHALL update reactively as revisions are added, accepted, or rejected.

#### Scenario: Sidebar shows a property change with old and new values

- **GIVEN** a paragraph with `alignment: 'right'` and `pPrChange: [{ revisionId: 7, author: 'Jane', date: '...', prior: { alignment: 'left' } }]`
- **WHEN** the sidebar renders
- **THEN** an entry appears with author "Jane", label resolved from `revisions.paragraphPropertiesChanged` (e.g. "Changed alignment from Left to Right"), Accept and Reject buttons, and `data-revision-id="7"` on the entry's DOM

#### Scenario: Sidebar updates after acceptance

- **GIVEN** the sidebar shows an entry for revision id 7
- **WHEN** the user clicks Accept on that entry
- **THEN** `acceptChangeById(7)` is dispatched; the entry disappears from the sidebar; the paragraph's `pPrChange` no longer contains the entry with id 7

#### Scenario: tblGridChange sidebar entry hides author and date

- **GIVEN** a table with `tblGridChange: { revisionId: 40, prior: <grid> }`
- **WHEN** the sidebar renders
- **THEN** an entry appears with kind label "Table grid changed" and no author or date display

### Requirement: Sidebar entries scroll-to-block on click

Clicking the body of a sidebar entry (not its Accept/Reject buttons) SHALL scroll the visible page so the affected block is in view, using the `data-revision-id` attribute on painted DOM to locate the target.

#### Scenario: Click sidebar entry navigates to block

- **GIVEN** a sidebar entry for a `pPrIns` on paragraph 12 of a long document
- **WHEN** the user clicks the entry's body
- **THEN** the page container scrolls so paragraph 12 is in view

### Requirement: Sidebar groups multi-site revisions as one entry

When multiple sites share the same revision triple (a row+cells row-insertion, a paired vertical-`cellMerge`, a multi-paragraph command applied in one operation), the sidebar SHALL render a single entry for the group with a kind label reflecting the group (e.g. "Inserted row" rather than four "Inserted cell" entries).

#### Scenario: Row insertion is one entry, not five

- **GIVEN** a row with `trIns: { revisionId: 8 }` and four cells each with `cellMarker: { kind: 'ins', info: { revisionId: 8, ... } }`
- **WHEN** the sidebar renders
- **THEN** **one** entry appears for revision triple `(8, author, date)` labeled "Inserted row" (not five entries)

### Requirement: i18n keys for every revision kind

`packages/i18n/en.json` SHALL contain a `revisions` namespace with the following keys, all 15 stubbed by Phase 1 (with English placeholder values that Phase 1 actually uses; Phase 2 and 3 fill in values for keys their phase introduces):

- `revisions.paragraphMarkInserted`
- `revisions.paragraphMarkDeleted`
- `revisions.paragraphPropertiesChanged`
- `revisions.paragraphMarkPropertiesChanged`
- `revisions.sectionPropertiesChanged`
- `revisions.runPropertiesChanged`
- `revisions.rowInserted`
- `revisions.rowDeleted`
- `revisions.rowPropertiesChanged`
- `revisions.cellInserted`
- `revisions.cellDeleted`
- `revisions.cellMerged`
- `revisions.cellPropertiesChanged`
- `revisions.tablePropertiesChanged`
- `revisions.tableGridChanged`

Each key MAY use named placeholders (`{author}`, `{rowIndex}`, `{from}`, `{to}`) interpolated by `t(...)`. All other locale files (`de`, `he`, `pl`, `pt-BR`, `tr`, `zh-CN`) SHALL mirror with null values via `bun run i18n:fix` so `bun run i18n:validate` is green.

#### Scenario: All revision kinds resolve a description in English

- **GIVEN** a document with one revision of every kind listed above
- **WHEN** the sidebar renders
- **THEN** no entry shows a missing-translation fallback for English; `bun run i18n:validate` passes
