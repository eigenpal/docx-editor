---
'@eigenpal/docx-editor-vue': patch
---

Fix the Vue right-click context menu (and image menu / tooltips) rendering unstyled — transparent, with no border or shadow. They teleport into `<body>`, outside the editor's `.ep-root` where the `--doc-*` color tokens are defined, so every token resolved to empty. The teleported roots now re-apply the editor's `.ep-root` (and current light/dark theme) so the tokens resolve.
