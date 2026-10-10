# Structural revision interoperability audit

Native reference: Microsoft Word for Mac 16.112.4 (16.112.26090911), September 17, 2026. All committed inputs and expectations are synthetic.

## Coverage

`structural-word-cases.ts` defines 41 inputs covering inserted/deleted paragraph breaks, consecutive and empty paragraphs, breaks before and inside tables, section breaks, paragraph/run/section property history, numbering-reference history, fields, hyperlinks, footnote references, bookmarks, content controls, nested tables, spanning rows, content inside tracked rows, table/row/cell properties, and paired moves.

The editor matrix exercises accept and reject individually and together, DOCX reload, no remaining live revisions, idempotence, and package-wide undo/redo. A separate 156-case matrix tests every nonempty row-removal subset for one through four rows, both actions, and direct/SDT/custom-XML row wrappers. Targeted tests cover locked landing cells, changed first rows, disappearing destination tables, excluded property decisions, malformed records, and two-peer replay/undo.

`structural-word-oracle.json` records native Word results for 80 action/case pairs. Tests compare text, paragraph alignment, table nesting, row/cell counts, grid-column counts, and spans. They do not compare ZIP bytes or claim pixel parity. Word changes run boundaries, identifiers, explicit defaults, and nested-table autofit widths on save. Dedicated property tests cover the observed section and numbering behavior.

## Native verification and exceptions

The original input and both final editor outputs opened in Word without a recovery prompt. Both outputs also exported to PDF through LibreOffice. The earlier invalid move fixture used deleted text in the move-source run; the corrected synthetic input uses ordinary text. Recovered documents were not used as references.

Word's bulk command leaves a sole tracked row in a nested table unresolved for the destructive direction: accepting the deleted row or rejecting the inserted row. Repeating Accept All still leaves that deletion pending. These two outputs are excluded from the Word oracle because they are not fully resolved references. The editor's explicit nested-table deletion behavior remains covered by the editor and row-combination tests; this is an interoperability difference, not proven Word parity.

When a rich content control becomes empty, Word writes a placeholder containing five spaces. The oracle normalizes that placeholder to an empty paragraph, preserving the distinction between placeholder display and document text.

## Observed fixes

- Removing a paragraph break immediately before a table moves its text into the first cell's first paragraph. The receiving paragraph keeps its formatting. Protection follows the actual surviving first row/cell.
- A valid numbering-reference insertion record is history metadata. Both directions remove the marker while retaining numbering; a rejected paragraph-property snapshot can independently restore prior numbering.
- Section-property rejection overlays recorded fields and retains unrecorded attributes/properties. An empty section history does not reset the section to defaults.

## Review UI

React and Vue show structural cards by default, with labels for row/cell insertion and deletion, merge changes, and numbering history. `structural={false}` remains an explicit opt-out. Run and paragraph formatting retains balloons by default; formatting without that painted anchor remains available in the sidebar.

Table, row, and cell decisions anchor in their own container, including cell merges and property history. UI tests exercise default visibility, explicit opt-out, individual accept/reject, undo, and the formatting fallback. Browser verification checks row markup, sidebar positioning, row removal, and restoration by undo. This audit does not assert complete Word rendering parity for every markup projection.
