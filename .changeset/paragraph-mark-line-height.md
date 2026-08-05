---
'@docx-editor.dev/react': patch
---

Auto and at-least line spacing now grow the line box below the glyphs, matching Word, so cover-page connectors like "between" no longer open a large gap above themselves while sitting tight on the next line. A taller paragraph mark still deepens the last line without shifting the text baseline.
