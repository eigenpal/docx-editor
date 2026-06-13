---
'@eigenpal/docx-editor-react': patch
---

Fix the document outline toggle rendering above the title bar File menu. The outline button now uses the shared `Z_INDEX.outline` layer (40) instead of 50, and the toolbar shell is raised to `Z_INDEX.toolbar` (100) so title-bar dropdowns stay on top. Vue parity: outline toggle at 40, toolbar shell at 100.
