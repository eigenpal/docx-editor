---
'@docx-editor.dev/core': patch
---

Documents in a legacy compatibility mode now compress East Asian punctuation to fit lines at every paragraph alignment, as they do for line-end hanging. A legacy line takes at most half a character of compression for one more character, and Korean text does not compress to fit.
