---
'@eigenpal/docx-editor-react': patch
---

Fix Find navigation in the paged editor: matches now map to live document positions, the page scrolls to the active match, and Enter advances through results instead of snapping back to the first. Fixes #321.
