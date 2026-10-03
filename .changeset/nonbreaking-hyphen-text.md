---
'@docx-editor.dev/core': patch
---

Text reads now include non-breaking and optional hyphens as U+001E and U+001F, search matches a typed hyphen against a non-breaking hyphen, and deleting text across a symbol or hyphen removes it with the text. Fixes #1071
