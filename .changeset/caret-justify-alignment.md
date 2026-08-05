---
'@docx-editor.dev/react': patch
---

Justified lines keep the caret on glyph edges instead of inside stretched spaces: layout places justification slack only after real spaces, spans publish per-character caret edges, and paint averages word-spacing only across those gaps.
