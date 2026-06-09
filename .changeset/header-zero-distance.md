---
'@eigenpal/docx-editor-core': patch
---

Honor an explicit `w:header="0"` / `w:footer="0"` (header/footer pinned to the page edge) instead of replacing the 0 distance with the 0.5in default. The wrong default over-reserved the header band and could push content onto an extra page versus Word. Fixes #740.
