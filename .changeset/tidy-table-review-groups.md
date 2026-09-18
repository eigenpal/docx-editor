---
'@docx-editor.dev/core': patch
---

Group adjacent tracked table rows, row and cell formatting histories, and equivalent adjacent run-formatting changes into review decisions. Resolve grouped decisions atomically through editor and automation commands, preserving independent revisions and checking structural dependencies. Nested rows created by Word include their tracked cell paragraph marks and text in the row decision.
