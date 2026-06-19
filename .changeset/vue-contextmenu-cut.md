---
'@eigenpal/docx-editor-vue': patch
---

Vue: Cut and Copy from the right-click context menu now work. The editor is focused before the clipboard command runs, so the selection is actually cut or copied, matching React.

Fixes #929
