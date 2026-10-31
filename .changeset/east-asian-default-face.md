---
'@docx-editor.dev/core': patch
---

Documents whose default East Asian font is Noto Sans CJK JP now compress punctuation and shrink justified spaces like other Japanese defaults, also when the face is not installed and the font table has no entry for it. Fixes #1663.
