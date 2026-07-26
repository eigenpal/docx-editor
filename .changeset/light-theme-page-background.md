---
'@docx-editor.dev/react': patch
---

Paint the page sheet in the default theme. `--doc-page-bg` was declared only inside the dark-mode block, so the page rendered transparent in light mode.
