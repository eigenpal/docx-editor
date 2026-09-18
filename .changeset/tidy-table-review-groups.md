---
'@docx-editor.dev/core': patch
---

Group adjacent tracked table rows, row and cell formatting histories, and equivalent adjacent run-formatting changes into review decisions. Resolve grouped decisions atomically through editor and automation commands, preserving independent revisions and checking structural dependencies. Nested rows created by Word include their tracked cell paragraph marks and text in the row decision.

Resolve shared table-grid histories with their remaining row decisions, and expose and resolve paragraph-local move ranges over ordinary tracked text, preserving dependent revisions and protected content.

Keep an unchanged table-property snapshot with its unambiguous cell-formatting decision, including nested width edits created by Word.
