---
'@docx-editor.dev/core': patch
---

Group adjacent tracked table rows, row and cell formatting histories, and equivalent adjacent run-formatting changes into review decisions. Resolve grouped decisions atomically through editor and automation commands, preserving independent revisions and checking structural dependencies. Nested rows created by Word include their tracked cell paragraph marks and text in the row decision.

Resolve shared table-grid histories with their remaining row decisions, and expose and resolve paragraph-local move ranges over ordinary tracked text, preserving dependent revisions and protected content.

Keep an unchanged table-property snapshot with its unambiguous cell-formatting decision, including nested width edits created by Word.

Restore the absence of a prior row height when rejecting Word’s complete implicit table-formatting snapshot bundle, while preserving partial or independent histories.

Match table alignment decisions and standalone table/grid metadata, and expose separate move and insertion decisions for orphan move destinations. Preserve existing nested tables during destructive row resolution and report a `retained-structure` reason when the outer row decision remains pending after its selected text changes resolve.

Restore unrecorded cell defaults and omitted trailing row space when rejecting table-formatting histories. Preserve protected and unknown content, and account for ancestor removals when reporting retained nested revisions.
