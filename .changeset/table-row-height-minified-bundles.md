---
'@docx-editor.dev/core': patch
---

Fix document layout when an app rebuilds the engine with a minifying bundler such as Vite 8. Documents with tables beside floating objects no longer fail to render or convert.
