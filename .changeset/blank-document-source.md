---
'@docx-editor.dev/core': minor
---

`document` and `load()` now accept `'blank'` for an empty document. Omitting `document` still means no document at all, which holds the editor on its loading screen with every control disabled. Fixes #275
