---
'@docx-editor.dev/core': patch
---

The East Asian font of the document defaults now counts as a Chinese, Japanese, or Korean face when the available face supports those code pages, so hanging punctuation, punctuation compression, and legacy space shrinking apply with faces such as Noto Sans CJK JP. Fixes #1663.
