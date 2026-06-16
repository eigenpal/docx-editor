---
'@eigenpal/docx-editor-i18n': patch
---

Fix Indonesian (id) locale interpolation: restore the `{total}`, `{minRows}/{maxRows}/{minCols}/{maxCols}`, and `{label}` placeholders that were renamed or dropped, so the find/replace match count, insert-table validation hint, and line-spacing tooltip render their values instead of literal braces.
