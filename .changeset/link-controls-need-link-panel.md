---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

The Insert link context menu row and toolbar button now open the mounted link panel, and the context menu row shows the Ctrl+K shortcut. If no link panel is mounted, both are disabled with a reason and Ctrl+K is left to the browser. Fixes #1592.
