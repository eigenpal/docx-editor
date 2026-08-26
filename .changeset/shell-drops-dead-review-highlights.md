---
'@docx-editor.dev/react': patch
---

Remove the `DocxEditorShell` review highlight styles, which targeted class names the editor does not render, so they never painted in any release. To mark the active comment or tracked change, use `Editor.setActiveReviewItem`. Fixes #481
