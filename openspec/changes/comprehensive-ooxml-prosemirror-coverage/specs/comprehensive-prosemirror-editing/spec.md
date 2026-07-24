## ADDED Requirements

### Requirement: ProseMirror is a capability-composed projection
The binding SHALL compose its ProseMirror schema, node views, forward mappers, and
reverse reconcilers from installed feature capabilities. ProseMirror state MUST NOT
become canonical authored or package state.

#### Scenario: Feature has no editable mapper
- **WHEN** a canonical feature is renderable but lacks an editable binding contribution
- **THEN** it projects as a typed read-only node/mark or remains outside the editable surface with an identity-bound read-only boundary

#### Scenario: Feature capability is absent
- **WHEN** an OOXML feature has no installed binding capability
- **THEN** the binding does not synthesize a generic editable representation that could flatten or rewrite it

### Requirement: Stable semantic identities bind projections to canonical records
Every projected structural node SHALL carry an internal semantic identity that
resolves to the correct document, story, container, and canonical record at the
current revision. Identities MUST be validated before generating semantic operations.

#### Scenario: Projected identity is forged or stale
- **WHEN** a ProseMirror node supplies an identity that is missing, wrong-kind, wrong-container, or stale
- **THEN** the transaction fails before canonical commit and the view reconciles to unchanged canonical state

### Requirement: Supported transactions map to minimal semantic operations
The binding SHALL apply each complete multi-step and appended ProseMirror transaction
to a shadow state, map affected ranges to capability-owned `DocOp`s, and commit one
atomic `DocumentStore` transaction. Mapping MUST NOT require a whole-document diff.

#### Scenario: Text is replaced inside one paragraph
- **WHEN** a user replaces a text range without crossing an unowned boundary
- **THEN** the binding emits operations scoped to that paragraph and range, preserves unedited run and capsule content, and commits once

#### Scenario: Paragraph is split or joined
- **WHEN** Enter, Backspace, or Delete produces a supported split or join
- **THEN** the binding emits identity-aware split/join operations at the exact offset and restores a valid selection after normalized reconciliation

#### Scenario: Multi-paragraph paste is unsupported
- **WHEN** pasted content cannot be represented safely by installed capabilities
- **THEN** the entire transaction is rejected with no partial canonical mutation

### Requirement: Reverse reconciliation is incremental
After canonical commit, the binding SHALL reconcile only affected projected ranges
using `ModelChange` before/after evidence or a binding revision index. It MUST
preserve valid text, node, table-cell, and control selections and MUST fall back only
to the smallest proven owned replacement range.

#### Scenario: Local optimistic shape matches normalized canonical state
- **WHEN** the mapped local transaction and normalized canonical result are projection-equivalent
- **THEN** reconciliation avoids replacing unaffected ProseMirror nodes and plugin state

#### Scenario: Agent edit changes another paragraph
- **WHEN** a headless semantic operation commits outside the active paragraph
- **THEN** the binding updates the affected projection without resetting the active selection or rebuilding the entire document

### Requirement: Unsupported structures are immutable boundaries
The binding MUST keep tables, SDTs, drawings, fields, notes, annotations, and other
structures without a complete editing contribution visible and read-only. Transactions
crossing, deleting, moving, duplicating, or partially rewriting those boundaries
MUST fail closed.

#### Scenario: User deletes across a read-only table
- **WHEN** a selection spans editable paragraph text and a read-only table node
- **THEN** deletion is disabled or rejected and neither canonical content nor preserved table XML changes

### Requirement: Rich paragraph editing preserves authored semantics
Once declared editable, paragraph and run binding SHALL support text, whitespace,
marks, fonts, size, color, underline, strike, baseline, caps, highlight, shading,
style, alignment, indentation, spacing, tabs, breaks, symbols, language, and
direction without erasing unedited authored distinctions.

#### Scenario: User edits text inside a richly formatted run
- **WHEN** text changes but formatting commands do not
- **THEN** the new text inherits the declared typing attributes and adjacent unsupported run children remain preserved or the edit is rejected

#### Scenario: User applies a paragraph style
- **WHEN** a supported style command is executed
- **THEN** the canonical paragraph stores the authored style reference and rendering resolves it without materializing inherited properties

### Requirement: Structural feature claims require complete declared semantics
The binding MUST keep tables, SDTs, sections, columns, related stories, notes,
drawings, links, bookmarks, fields, comments, and revisions read-only until their semantic
operations, validation, locks, ownership, serialization, and reopen behavior pass
conformance for the exact declared interaction. A capability MAY enable a
narrow operation such as owned table-cell text editing or atomic image
selection independently, but it MUST report only that proven matrix and MUST
keep every unproven operation read-only. An aggregate structural-feature editing
claim requires the complete declared operation set.

#### Scenario: Table cell text lane becomes editable
- **WHEN** table-cell text ownership, selection, mapping, validation, serialization, and reopen pass while structural table operations remain incomplete
- **THEN** only the proven cell-text matrix MAY be enabled and row/column, merge/split, dimension, border, shading, and header-row operations MUST remain read-only

#### Scenario: Complete table editing claim becomes enabled
- **WHEN** aggregate table editing is declared
- **THEN** cell text, row/column insertion and deletion, merge/split, dimensions, borders, shading, and header-row operations preserve canonical identities and pass save/reopen evidence

#### Scenario: Content control is locked
- **WHEN** a user attempts an operation forbidden by the authored SDT lock
- **THEN** the operation returns `locked` without changing canonical state or projection

#### Scenario: Image is replaced
- **WHEN** a user replaces an embedded image
- **THEN** media bytes, relationship, content type, dimensions, alt text, and drawing identity update atomically without fetching a remote resource

#### Scenario: Comment range is edited
- **WHEN** a user creates, moves, edits, or deletes a comment
- **THEN** comment part records, range markers, references, identities, and display anchors update atomically without inventing thread metadata

### Requirement: IME and clipboard behavior are deterministic
The binding SHALL preserve composition text, anchored composition ranges, ordered
inbound changes, selection affinity, and one semantic history group per committed
composition. Clipboard input SHALL pass bounded sanitization and capability mapping.

#### Scenario: Remote or agent edit intersects composition
- **WHEN** an inbound canonical change intersects an active IME range
- **THEN** reconciliation is deferred according to the reviewed IME state machine and composition commits or cancels without duplicate or lost text

#### Scenario: Pasted HTML contains unsafe content
- **WHEN** pasted HTML includes unsafe URLs, unknown elements, styles, or excessive structure
- **THEN** the bounded clipboard parser sanitizes or rejects it before any canonical operation

### Requirement: Editing stays off the layout critical path
The synchronous input path SHALL be bounded by the affected ProseMirror range,
semantic-operation validation, canonical commit, and minimal reconciliation. Full
pagination and offscreen repaint MUST run asynchronously from the earliest affected
flow position.

#### Scenario: One paragraph changes in a 300-page document
- **WHEN** a bounded edit has a bounded dependency closure
- **THEN** instrumentation reports no whole-document PM scan, projection, clone, DOM walk, serialization, layout rebuild, or repaint on the synchronous path

### Requirement: Save and reopen prove editable support
An editing capability SHALL NOT be declared supported until the edited document saves
and reopens to the capability's authored equivalence comparator while every unrelated
package part and unsupported capsule remains unchanged.

#### Scenario: Supported feature is edited in comprehensive fixture
- **WHEN** a capability-specific edit is applied to a named fixture region
- **THEN** reopen reproduces the intended authored change, preserves unrelated source defects and package members, and yields equivalent rendering for unaffected regions
